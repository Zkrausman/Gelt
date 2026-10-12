package shadow

import "gelt/pkg/config"

// getInitialBalance retrieves the initial balance from AppConfig,
// falling back to 10000.0 if not configured or if an error occurs.
func getInitialBalance() float64 {
	appCfg, err := config.LoadAppConfig()
	if err == nil && appCfg != nil && appCfg.TotalCapitalUSD > 0 {
		return appCfg.TotalCapitalUSD
	}
	return 10000.0
}
