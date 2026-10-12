package plans

import (
	"context"
	"testing"
	"time"

	"gelt/pkg/data"
	"gelt/pkg/strategies"
)

func TestCryptoPlan_Evaluate(t *testing.T) {
	plan := NewCryptoPlan()
	reg := data.NewFeatureRegistry()
	if err := plan.Init(reg); err != nil {
		t.Fatalf("failed to init crypto plan: %v", err)
	}

	closes, volumes := sampleData()

	eval, err := plan.Evaluate(context.Background(), time.Now(), "BTCUSD", closes, volumes)
	if err != nil {
		t.Fatalf("plan evaluation failed: %v", err)
	}

	if eval.AssetClass != strategies.AssetCrypto {
		t.Errorf("expected AssetClass %s, got %s", strategies.AssetCrypto, eval.AssetClass)
	}

	baseEval, err := plan.BasePlan.Evaluate(context.Background(), time.Now(), "BTCUSD", closes, volumes)
	if err != nil {
		t.Fatalf("base plan evaluation failed: %v", err)
	}

	expectedStop := baseEval.StopLossPct * 1.75
	expectedTarget := baseEval.TargetPct * 1.75

	if eval.StopLossPct != expectedStop {
		t.Errorf("expected StopLossPct to be %.4f, got %.4f", expectedStop, eval.StopLossPct)
	}

	if eval.TargetPct != expectedTarget {
		t.Errorf("expected TargetPct to be %.4f, got %.4f", expectedTarget, eval.TargetPct)
	}
}
