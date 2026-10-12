package notify_test

import (
	"testing"

	"gelt/pkg/notify"
)

func TestNewDiscordBot(t *testing.T) {
	tests := []struct {
		name    string
		token   string
		wantErr bool
	}{
		{
			name:    "Empty Token",
			token:   "",
			wantErr: true,
		},
		{
			name:    "Valid Token Initialization",
			token:   "test-token",
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			bot, err := notify.NewDiscordBot(tt.token)
			if (err != nil) != tt.wantErr {
				t.Errorf("NewDiscordBot() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && bot == nil {
				t.Errorf("NewDiscordBot() returned nil bot for valid token")
			}

		})
	}
}

func TestDiscordBot_Lifecycle(t *testing.T) {
	bot, err := notify.NewDiscordBot("test-token")
	if err != nil {
		t.Fatalf("Failed to create bot: %v", err)
	}

	// For the test, we only verify that Stop() doesn't panic on an unstarted session.
	// We cannot call Start() as it would attempt to connect to Discord and timeout/fail in CI.
	err = bot.Stop()
	if err != nil {
		t.Errorf("Stop() returned error on disconnected bot: %v", err)
	}
}