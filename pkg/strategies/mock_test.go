package strategies

import (
	"context"

	"gelt/pkg/data"
)

// mockFeatureProvider implements data.FeatureProvider for deterministic testing.
type mockFeatureProvider struct {
	points []data.DataPoint
	err    error
}

func (m *mockFeatureProvider) Fetch(ctx context.Context, req data.FeatureRequest) ([]data.DataPoint, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.points, nil
}
