package terminal

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	apertureauth "github.com/lightninglabs/aperture/auth"
	aperturel402 "github.com/lightninglabs/aperture/l402"
	aperturemint "github.com/lightninglabs/aperture/mint"
	"github.com/lightningnetwork/lnd/lnrpc"
	"github.com/lightningnetwork/lnd/lntypes"
	"github.com/stretchr/testify/require"
)

func TestSkillPaywallManifestDoesNotLeakContent(t *testing.T) {
	svc, _ := newTestSkillPaywallService(t)

	req := httptest.NewRequest(http.MethodGet, svc.skill.ManifestURL, nil)
	resp := httptest.NewRecorder()

	handled := svc.isHandling(resp, req)
	require.True(t, handled)
	require.Equal(t, http.StatusOK, resp.Code)

	var manifest paidSkillManifest
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &manifest))
	require.Equal(t, svc.skill.ID, manifest.SkillID)
	require.Equal(t, svc.skill.ContentHash, manifest.ContentSHA256)
	require.NotContains(t, resp.Body.String(), string(svc.skill.Content))
}

func TestSkillPaywallRequiresL402Challenge(t *testing.T) {
	svc, _ := newTestSkillPaywallService(t)

	req := httptest.NewRequest(http.MethodGet, svc.skill.ContentURL, nil)
	resp := httptest.NewRecorder()

	handled := svc.isHandling(resp, req)
	require.True(t, handled)
	require.Equal(t, http.StatusPaymentRequired, resp.Code)
	require.Contains(t, resp.Header().Values("WWW-Authenticate")[0], "LSAT ")
	require.Contains(t, strings.Join(resp.Header().Values("WWW-Authenticate"), " "),
		"L402 ")
	require.NotContains(t, resp.Body.String(), string(svc.skill.Content))
}

func TestSkillPaywallAllowsValidL402(t *testing.T) {
	svc, minter := newTestSkillPaywallService(t)

	mac, _, err := minter.MintL402(context.Background(), aperturel402.Service{
		Name:  svc.skill.ServiceName,
		Tier:  aperturel402.BaseTier,
		Price: svc.skill.PriceSats,
	})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, svc.skill.ContentURL, nil)
	require.NoError(t, aperturel402.SetHeader(&req.Header, mac, testPreimage))

	resp := httptest.NewRecorder()
	handled := svc.isHandling(resp, req)
	require.True(t, handled)
	require.Equal(t, http.StatusOK, resp.Code)
	require.Equal(t, string(svc.skill.Content), resp.Body.String())
	require.Equal(t, `"`+svc.skill.ContentHash+`"`, resp.Header().Get("ETag"))
}

func TestSkillPaywallRejectsBasicAuthBypass(t *testing.T) {
	svc, _ := newTestSkillPaywallService(t)

	req := httptest.NewRequest(http.MethodGet, svc.skill.ContentURL, nil)
	req.Header.Set("Authorization", "Basic dGVzdDp0ZXN0")

	resp := httptest.NewRecorder()
	handled := svc.isHandling(resp, req)
	require.True(t, handled)
	require.Equal(t, http.StatusPaymentRequired, resp.Code)
}

func TestSkillPaywallUnknownVersionReturns404(t *testing.T) {
	svc, _ := newTestSkillPaywallService(t)

	req := httptest.NewRequest(
		http.MethodGet,
		svc.skill.ManifestURL+"/v/not-a-real-version/content",
		nil,
	)
	resp := httptest.NewRecorder()

	handled := svc.isHandling(resp, req)
	require.True(t, handled)
	require.Equal(t, http.StatusNotFound, resp.Code)
}

var testPreimage = func() lntypes.Preimage {
	var preimage lntypes.Preimage
	copy(preimage[:], []byte("0123456789abcdef0123456789abcdef"))
	return preimage
}()

func newTestSkillPaywallService(t *testing.T) (*skillPaywallService,
	*aperturemint.Mint) {

	t.Helper()

	content := []byte("# paid skill\n\nsecret content\n")
	contentHash := sha256.Sum256(content)
	contentHashHex := fmt.Sprintf("%x", contentHash[:])
	manifestURL := skillPaywallManifestRoot + "/test-skill"

	checker := &mockSkillPaywallChecker{
		invoice:   "lnbc1testinvoice",
		preimage:  testPreimage,
		allowPaid: true,
	}
	minter := aperturemint.New(&aperturemint.Config{
		Secrets:        newMockSkillSecretStore(),
		Challenger:     checker,
		ServiceLimiter: staticSkillServiceLimiter{},
		Now:            time.Now,
	})

	return &skillPaywallService{
		skill: paidSkill{
			ID:          "test-skill",
			Title:       "Test Skill",
			Summary:     "summary",
			Content:     content,
			ContentHash: contentHashHex,
			PriceSats:   21,
			ManifestURL: manifestURL,
			ContentURL:  manifestURL + "/v/" + contentHashHex + "/content",
			ServiceName: "skill-test-skill-" + contentHashHex,
		},
		authenticator: apertureauth.NewL402Authenticator(minter, checker),
	}, minter
}

type mockSkillPaywallChecker struct {
	invoice   string
	preimage  lntypes.Preimage
	allowPaid bool
}

func (m *mockSkillPaywallChecker) NewChallenge(price int64) (string,
	lntypes.Hash, error) {

	return m.invoice, m.preimage.Hash(), nil
}

func (m *mockSkillPaywallChecker) Stop() {}

func (m *mockSkillPaywallChecker) VerifyInvoiceStatus(hash lntypes.Hash,
	_ lnrpc.Invoice_InvoiceState, _ time.Duration) error {

	if !m.allowPaid {
		return fmt.Errorf("invoice not settled")
	}

	if hash != m.preimage.Hash() {
		return fmt.Errorf("unexpected payment hash")
	}

	return nil
}

type mockSkillSecretStore struct {
	secrets map[[sha256.Size]byte][aperturel402.SecretSize]byte
}

func newMockSkillSecretStore() *mockSkillSecretStore {
	return &mockSkillSecretStore{
		secrets: make(map[[sha256.Size]byte][aperturel402.SecretSize]byte),
	}
}

func (m *mockSkillSecretStore) NewSecret(_ context.Context,
	key [sha256.Size]byte) ([aperturel402.SecretSize]byte, error) {

	var secret [aperturel402.SecretSize]byte
	copy(secret[:], []byte("abcdefghijklmnopqrstuvwxyz123456"))
	m.secrets[key] = secret
	return secret, nil
}

func (m *mockSkillSecretStore) GetSecret(_ context.Context,
	key [sha256.Size]byte) ([aperturel402.SecretSize]byte, error) {

	secret, ok := m.secrets[key]
	if !ok {
		return secret, aperturemint.ErrSecretNotFound
	}

	return secret, nil
}

func (m *mockSkillSecretStore) RevokeSecret(_ context.Context,
	key [sha256.Size]byte) error {

	delete(m.secrets, key)
	return nil
}
