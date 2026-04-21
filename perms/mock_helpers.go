package perms

import (
	"net"
	"reflect"

	"github.com/btcsuite/btcd/chaincfg"
	"github.com/lightningnetwork/lnd/autopilot"
	"github.com/lightningnetwork/lnd/chainreg"
	graphdb "github.com/lightningnetwork/lnd/graph/db"
	"github.com/lightningnetwork/lnd/lnrpc/autopilotrpc"
	"github.com/lightningnetwork/lnd/lnrpc/chainrpc"
	"github.com/lightningnetwork/lnd/lnrpc/devrpc"
	"github.com/lightningnetwork/lnd/lnrpc/routerrpc"
	"github.com/lightningnetwork/lnd/lnrpc/signrpc"
	"github.com/lightningnetwork/lnd/lnrpc/walletrpc"
	"github.com/lightningnetwork/lnd/lnrpc/wtclientrpc"
	"github.com/lightningnetwork/lnd/lntest/mock"
	"github.com/lightningnetwork/lnd/routing"
	"github.com/lightningnetwork/lnd/sweep"
)

func newWatchtowerClientRPCConfig() *wtclientrpc.Config {
	return &wtclientrpc.Config{
		Resolver: func(_, _ string) (*net.TCPAddr, error) {
			return nil, nil
		},
	}
}

func newAutopilotRPCConfig() *autopilotrpc.Config {
	cfg := &autopilotrpc.Config{}
	setOptionalStructField(cfg, "Manager", &autopilot.Manager{})

	return cfg
}

func newChainRPCConfig() *chainrpc.Config {
	cfg := &chainrpc.Config{}
	setOptionalStructField(cfg, "ChainNotifier", &chainreg.NoChainBackend{})
	setOptionalStructField(cfg, "Chain", &mock.ChainIO{})

	return cfg
}

func newDevRPCConfig() *devrpc.Config {
	cfg := &devrpc.Config{}
	setOptionalStructField(
		cfg, "ActiveNetParams", &chaincfg.RegressionNetParams,
	)
	setOptionalStructField(cfg, "GraphDB", &graphdb.ChannelGraph{})

	return cfg
}

func newRouterRPCConfig() *routerrpc.Config {
	return &routerrpc.Config{
		Router: &routing.ChannelRouter{},
	}
}

func newSignRPCConfig() *signrpc.Config {
	cfg := &signrpc.Config{}
	setOptionalStructField(cfg, "Signer", &mock.DummySigner{})

	return cfg
}

func newWalletKitRPCConfig() *walletrpc.Config {
	cfg := &walletrpc.Config{}
	setOptionalStructField(cfg, "FeeEstimator", &chainreg.NoChainBackend{})
	setOptionalStructField(cfg, "Wallet", &mock.WalletController{})
	setOptionalStructField(cfg, "KeyRing", &mock.SecretKeyRing{})
	setOptionalStructField(cfg, "Sweeper", &sweep.UtxoSweeper{})
	setOptionalStructField(cfg, "Chain", &mock.ChainIO{})

	return cfg
}

func setOptionalStructField(target any, fieldName string, value any) {
	if target == nil || value == nil {
		return
	}

	targetVal := reflect.ValueOf(target)
	if targetVal.Kind() != reflect.Pointer || targetVal.IsNil() {
		return
	}

	structVal := targetVal.Elem()
	if structVal.Kind() != reflect.Struct {
		return
	}

	field := structVal.FieldByName(fieldName)
	if !field.IsValid() || !field.CanSet() {
		return
	}

	valueVal := reflect.ValueOf(value)
	if !valueVal.IsValid() {
		return
	}

	switch {
	case valueVal.Type().AssignableTo(field.Type()):
		field.Set(valueVal)

	case valueVal.Type().ConvertibleTo(field.Type()):
		field.Set(valueVal.Convert(field.Type()))
	}
}
