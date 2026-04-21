//go:build !dev

package perms

import (
	"github.com/lightningnetwork/lnd/lnrpc"
	"github.com/lightningnetwork/lnd/lnrpc/devrpc"
	"github.com/lightningnetwork/lnd/lnrpc/invoicesrpc"
	"github.com/lightningnetwork/lnd/lnrpc/neutrinorpc"
	"github.com/lightningnetwork/lnd/lnrpc/peersrpc"
	"github.com/lightningnetwork/lnd/lnrpc/watchtowerrpc"
)

// mockConfig implements lnrpc.SubServerConfigDispatcher. It provides the
// functionality required so that the lnrpc.GrpcHandler.CreateSubServer
// function can be called without panicking.
type mockConfig struct{}

var _ lnrpc.SubServerConfigDispatcher = (*mockConfig)(nil)

// FetchConfig is a mock implementation of lnrpc.SubServerConfigDispatcher. It
// is used as a parameter to lnrpc.GrpcHandler.CreateSubServer and allows the
// function to be called without panicking. This is useful because
// CreateSubServer can be used to extract the permissions required by each
// registered subserver.
//
// TODO(elle): remove this once the sub-server permission lists in LND have been
// exported
func (t *mockConfig) FetchConfig(subServerName string) (interface{}, bool) {
	switch subServerName {
	case "InvoicesRPC":
		return &invoicesrpc.Config{}, true
	case "WatchtowerClientRPC":
		return newWatchtowerClientRPCConfig(), true
	case "AutopilotRPC":
		return newAutopilotRPCConfig(), true
	case "ChainRPC":
		return newChainRPCConfig(), true
	case "DevRPC":
		return &devrpc.Config{}, true
	case "NeutrinoKitRPC":
		return &neutrinorpc.Config{}, true
	case "PeersRPC":
		return &peersrpc.Config{}, true
	case "RouterRPC":
		return newRouterRPCConfig(), true
	case "SignRPC":
		return newSignRPCConfig(), true
	case "WalletKitRPC":
		return newWalletKitRPCConfig(), true
	case "WatchtowerRPC":
		return &watchtowerrpc.Config{}, true
	default:
		return nil, false
	}
}
