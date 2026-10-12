package notify

import (
	"fmt"
	"log/slog"
	"os"

	"github.com/bwmarrin/discordgo"
)

// DiscordBot maintains a persistent WebSocket connection to Discord Gateway.
type DiscordBot struct {
	Session *discordgo.Session
	token   string
}

// NewDiscordBot creates a new DiscordBot instance.
func NewDiscordBot(token string) (*DiscordBot, error) {
	if token == "" {
		return nil, fmt.Errorf("discord bot token is empty")
	}

	// Create a new Discord session using the provided bot token.
	session, err := discordgo.New("Bot " + token)
	if err != nil {
		return nil, fmt.Errorf("error creating Discord session: %w", err)
	}

	// Configure bot intents
	session.Identify.Intents = discordgo.IntentsGuildMessages | discordgo.IntentsMessageContent

	return &DiscordBot{
		Session: session,
		token:   token,
	}, nil
}

// Start opens a websocket connection to Discord and begins listening.
func (b *DiscordBot) Start() error {
	// Register the ready event handler
	b.Session.AddHandler(func(s *discordgo.Session, r *discordgo.Ready) {
		logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
		logger.Info("[Discord Bot] Connected", "username", s.State.User.Username)
	})

	// Open a websocket connection to Discord and begin listening.
	err := b.Session.Open()
	if err != nil {
		return fmt.Errorf("error opening connection: %w", err)
	}

	return nil
}

// Stop gracefully closes the websocket connection to Discord.
func (b *DiscordBot) Stop() error {
	if b.Session != nil {
		return b.Session.Close()
	}
	return nil
}
