package terminal

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	apertureauth "github.com/lightninglabs/aperture/auth"
	aperturechallenger "github.com/lightninglabs/aperture/challenger"
	aperturel402 "github.com/lightninglabs/aperture/l402"
	aperturemint "github.com/lightninglabs/aperture/mint"
	"github.com/lightningnetwork/lnd/lnrpc"
)

const (
	skillPaywallPurchaseModel = "one_purchase_per_immutable_version"
	skillPaywallManifestRoot  = "/.well-known/l402/skills"
	skillPaywallSecretDir     = "skill-paywall/secrets"
	skillPaywallInvoiceExpiry = 3600
)

var errSkillPaywallNotReady = errors.New("skill paywall is not ready")

type paidSkill struct {
	ID          string
	Title       string
	Summary     string
	Content     []byte
	ContentHash string
	PriceSats   int64
	ManifestURL string
	ContentURL  string
	ServiceName string
}

type paidSkillManifest struct {
	SkillID       string `json:"skill_id"`
	Title         string `json:"title"`
	Summary       string `json:"summary"`
	PurchaseModel string `json:"purchase_model"`
	PriceSats     int64  `json:"price_sats"`
	ContentSHA256 string `json:"content_sha256"`
	ManifestURL   string `json:"manifest_url"`
	PaidURL       string `json:"paid_url"`
	ContentType   string `json:"content_type"`
}

type skillPaywallService struct {
	skill paidSkill

	lndClient lndBasicClientFn
	secrets   *fileSecretStore

	authMtx        sync.Mutex
	authenticator  *apertureauth.L402Authenticator
	challengerStop func()
}

func newSkillPaywallService(cfg *Config,
	lndClient lndBasicClientFn) (*skillPaywallService, error) {

	content, err := base64.StdEncoding.DecodeString(
		paywalledSkillContentBase64,
	)
	if err != nil {
		return nil, fmt.Errorf("decode paywalled skill content: %w", err)
	}

	contentHash := sha256.Sum256(content)
	contentHashHex := hex.EncodeToString(contentHash[:])
	manifestURL := skillPaywallManifestRoot + "/" + paywalledSkillID

	secrets, err := newFileSecretStore(
		filepath.Join(cfg.LitDir, skillPaywallSecretDir),
	)
	if err != nil {
		return nil, err
	}

	skill := paidSkill{
		ID:          paywalledSkillID,
		Title:       paywalledSkillTitle,
		Summary:     paywalledSkillSummary,
		Content:     content,
		ContentHash: contentHashHex,
		PriceSats:   paywalledSkillPriceSats,
		ManifestURL: manifestURL,
		ContentURL:  manifestURL + "/v/" + contentHashHex + "/content",
		ServiceName: "skill-" + paywalledSkillID + "-" + contentHashHex,
	}

	return &skillPaywallService{
		skill:     skill,
		lndClient: lndClient,
		secrets:   secrets,
	}, nil
}

func (s *skillPaywallService) stop() error {
	s.authMtx.Lock()
	defer s.authMtx.Unlock()

	if s.challengerStop != nil {
		s.challengerStop()
		s.challengerStop = nil
	}

	return nil
}

func (s *skillPaywallService) isHandling(resp http.ResponseWriter,
	req *http.Request) bool {

	path := strings.TrimSuffix(req.URL.Path, "/")
	switch {
	case path == s.skill.ManifestURL:
		s.serveManifest(resp, req)
		return true

	case path == s.skill.ContentURL:
		s.servePaidContent(resp, req)
		return true

	case strings.HasPrefix(path, s.skill.ManifestURL+"/v/"):
		s.writeError(resp, req, http.StatusNotFound, "unknown skill version")
		return true

	default:
		return false
	}
}

func (s *skillPaywallService) serveManifest(resp http.ResponseWriter,
	req *http.Request) {

	switch req.Method {
	case http.MethodGet, http.MethodHead:
	case http.MethodOptions:
		s.writePreflight(resp)
		return
	default:
		s.writeMethodNotAllowed(resp, req)
		return
	}

	s.addCORSHeaders(resp.Header())
	resp.Header().Set("Allow", "GET, HEAD, OPTIONS")
	resp.Header().Set("Cache-Control", "public, max-age=300")
	resp.Header().Set("Content-Type", "application/json; charset=utf-8")

	manifest := paidSkillManifest{
		SkillID:       s.skill.ID,
		Title:         s.skill.Title,
		Summary:       s.skill.Summary,
		PurchaseModel: skillPaywallPurchaseModel,
		PriceSats:     s.skill.PriceSats,
		ContentSHA256: s.skill.ContentHash,
		ManifestURL:   s.skill.ManifestURL,
		PaidURL:       s.skill.ContentURL,
		ContentType:   "text/markdown; charset=utf-8",
	}
	s.writeJSON(resp, req, http.StatusOK, manifest)
}

func (s *skillPaywallService) servePaidContent(resp http.ResponseWriter,
	req *http.Request) {

	switch req.Method {
	case http.MethodGet, http.MethodHead:
	case http.MethodOptions:
		s.writePreflight(resp)
		return
	default:
		s.writeMethodNotAllowed(resp, req)
		return
	}

	authenticator, err := s.ensureAuthenticator()
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errSkillPaywallNotReady) {
			status = http.StatusServiceUnavailable
		}

		log.Warnf("Skill paywall unavailable: %v", err)
		s.writeError(resp, req, status, "skill paywall unavailable")
		return
	}

	if !authenticator.Accept(&req.Header, s.skill.ServiceName) {
		s.writeChallenge(resp, req, authenticator)
		return
	}

	s.addCORSHeaders(resp.Header())
	resp.Header().Set("Allow", "GET, HEAD, OPTIONS")
	resp.Header().Set("Cache-Control", "private, no-store")
	resp.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	resp.Header().Set("ETag", `"`+s.skill.ContentHash+`"`)
	resp.Header().Set("X-Skill-Version", s.skill.ContentHash)

	resp.WriteHeader(http.StatusOK)
	if req.Method != http.MethodHead {
		_, _ = resp.Write(s.skill.Content)
	}
}

func (s *skillPaywallService) writeChallenge(resp http.ResponseWriter,
	req *http.Request, authenticator *apertureauth.L402Authenticator) {

	header, err := authenticator.FreshChallengeHeader(
		s.skill.ServiceName, s.skill.PriceSats,
	)
	if err != nil {
		log.Errorf("Skill paywall challenge failed: %v", err)
		s.writeError(resp, req, http.StatusInternalServerError,
			"unable to create payment challenge")
		return
	}

	s.addCORSHeaders(resp.Header())
	resp.Header().Set("Allow", "GET, HEAD, OPTIONS")
	resp.Header().Set("Cache-Control", "private, no-store")
	for name, values := range header {
		if strings.EqualFold(name, "Content-Type") {
			continue
		}

		resp.Header().Del(name)
		for _, value := range values {
			resp.Header().Add(name, value)
		}
	}
	resp.Header().Set("Content-Type", "application/json; charset=utf-8")

	body := map[string]any{
		"error":          "payment_required",
		"skill_id":       s.skill.ID,
		"purchase_model": skillPaywallPurchaseModel,
		"price_sats":     s.skill.PriceSats,
		"content_sha256": s.skill.ContentHash,
		"paid_url":       s.skill.ContentURL,
	}
	s.writeJSON(resp, req, http.StatusPaymentRequired, body)
}

func (s *skillPaywallService) ensureAuthenticator() (
	*apertureauth.L402Authenticator, error) {

	s.authMtx.Lock()
	defer s.authMtx.Unlock()

	if s.authenticator != nil {
		return s.authenticator, nil
	}

	lndClient, err := s.lndClient()
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errSkillPaywallNotReady, err)
	}

	genInvoiceReq := func(price int64) (*lnrpc.Invoice, error) {
		return &lnrpc.Invoice{
			Value:   price,
			Private: true,
			Expiry:  skillPaywallInvoiceExpiry,
			Memo: fmt.Sprintf(
				"L402 %s@%s", s.skill.ID, s.skill.ContentHash[:12],
			),
		}, nil
	}

	challenger, err := aperturechallenger.NewLndChallenger(
		lndClient, 100, genInvoiceReq, context.Background, nil, false,
	)
	if err != nil {
		return nil, fmt.Errorf("new lnd challenger: %w", err)
	}

	minter := aperturemint.New(&aperturemint.Config{
		Secrets:        s.secrets,
		Challenger:     challenger,
		ServiceLimiter: staticSkillServiceLimiter{},
		Now:            nil,
	})
	s.authenticator = apertureauth.NewL402Authenticator(minter, challenger)
	s.challengerStop = challenger.Stop

	return s.authenticator, nil
}

func (s *skillPaywallService) addCORSHeaders(header http.Header) {
	header.Set("Access-Control-Allow-Origin", "*")
	header.Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	header.Set(
		"Access-Control-Allow-Headers",
		"Authorization, Content-Type, WWW-Authenticate",
	)
	header.Set(
		"Access-Control-Expose-Headers",
		"WWW-Authenticate, ETag, X-Skill-Version",
	)
}

func (s *skillPaywallService) writePreflight(resp http.ResponseWriter) {
	s.addCORSHeaders(resp.Header())
	resp.Header().Set("Allow", "GET, HEAD, OPTIONS")
	resp.WriteHeader(http.StatusNoContent)
}

func (s *skillPaywallService) writeMethodNotAllowed(resp http.ResponseWriter,
	req *http.Request) {

	resp.Header().Set("Allow", "GET, HEAD, OPTIONS")
	s.writeError(resp, req, http.StatusMethodNotAllowed,
		"method not allowed")
}

func (s *skillPaywallService) writeError(resp http.ResponseWriter,
	req *http.Request, status int, message string) {

	s.addCORSHeaders(resp.Header())
	resp.Header().Set("Cache-Control", "no-store")
	resp.Header().Set("Content-Type", "application/json; charset=utf-8")
	s.writeJSON(resp, req, status, map[string]string{
		"error": message,
	})
}

func (s *skillPaywallService) writeJSON(resp http.ResponseWriter,
	req *http.Request, status int, body any) {

	resp.WriteHeader(status)
	if req.Method == http.MethodHead {
		return
	}

	_ = json.NewEncoder(resp).Encode(body)
}

type staticSkillServiceLimiter struct{}

func (staticSkillServiceLimiter) ServiceCapabilities(context.Context,
	...aperturel402.Service) ([]aperturel402.Caveat, error) {

	return nil, nil
}

func (staticSkillServiceLimiter) ServiceConstraints(context.Context,
	...aperturel402.Service) ([]aperturel402.Caveat, error) {

	return nil, nil
}

func (staticSkillServiceLimiter) ServiceTimeouts(context.Context,
	...aperturel402.Service) ([]aperturel402.Caveat, error) {

	return nil, nil
}

type fileSecretStore struct {
	dir string
}

func newFileSecretStore(dir string) (*fileSecretStore, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create skill paywall secret dir: %w", err)
	}

	return &fileSecretStore{dir: dir}, nil
}

func (f *fileSecretStore) NewSecret(_ context.Context,
	key [sha256.Size]byte) ([aperturel402.SecretSize]byte, error) {

	var secret [aperturel402.SecretSize]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return secret, err
	}

	path := f.secretPath(key)
	tmpPath := path + ".tmp-" + randId(8)
	if err := os.WriteFile(tmpPath, secret[:], 0o600); err != nil {
		return secret, err
	}

	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return secret, err
	}

	return secret, nil
}

func (f *fileSecretStore) GetSecret(_ context.Context,
	key [sha256.Size]byte) ([aperturel402.SecretSize]byte, error) {

	var secret [aperturel402.SecretSize]byte

	raw, err := os.ReadFile(f.secretPath(key))
	switch {
	case errors.Is(err, os.ErrNotExist):
		return secret, aperturemint.ErrSecretNotFound

	case err != nil:
		return secret, err
	}

	if len(raw) != aperturel402.SecretSize {
		return secret, fmt.Errorf("invalid secret size %d", len(raw))
	}

	copy(secret[:], raw)
	return secret, nil
}

func (f *fileSecretStore) RevokeSecret(_ context.Context,
	key [sha256.Size]byte) error {

	err := os.Remove(f.secretPath(key))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}

	return err
}

func (f *fileSecretStore) secretPath(key [sha256.Size]byte) string {
	return filepath.Join(f.dir, hex.EncodeToString(key[:])+".secret")
}
