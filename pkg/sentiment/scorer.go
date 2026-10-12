package sentiment

import (
	"gelt/pkg/data"
	"strings"

	"github.com/jonreiter/govader"
)

// SentimentAnalyzer wraps the govader analyzer to evaluate text sentiment.
type SentimentAnalyzer struct {
	analyzer *govader.SentimentIntensityAnalyzer
}

// NewSentimentAnalyzer creates a new SentimentAnalyzer.
func NewSentimentAnalyzer() *SentimentAnalyzer {
	analyzer := govader.NewSentimentIntensityAnalyzer()

	// Add some financial slang to the lexicon so it understands retail sentiment
	analyzer.Lexicon["printing"] = 2.5
	analyzer.Lexicon["tanking"] = -2.5
	analyzer.Lexicon["moon"] = 2.5
	analyzer.Lexicon["calls"] = 1.0
	analyzer.Lexicon["puts"] = -1.0
	analyzer.Lexicon["bullish"] = 2.0
	analyzer.Lexicon["bearish"] = -2.0
	analyzer.Lexicon["losing"] = -3.0
	analyzer.Lexicon["terrible"] = -3.0

	return &SentimentAnalyzer{
		analyzer: analyzer,
	}
}

// EvaluateText evaluates the given text and returns a normalized compound
// polarity score ranging from -1.0 (extremely negative) to +1.0 (extremely positive).
func (s *SentimentAnalyzer) EvaluateText(text string) (float64, error) {
	sentiment := s.analyzer.PolarityScores(text)
	return sentiment.Compound, nil
}

// EvaluateRedditPosts processes a list of Reddit posts, filters them by a specific
// keyword, and computes an average retail momentum score ranging from 0.0 to 100.0.
func (s *SentimentAnalyzer) EvaluateRedditPosts(posts []data.RedditPost, keyword string) float64 {
	var totalScore float64
	var count int

	keywordLower := strings.ToLower(keyword)

	for _, post := range posts {
		if strings.Contains(strings.ToLower(post.Title), keywordLower) || strings.Contains(strings.ToLower(post.Body), keywordLower) {

			// Evaluate title and body separately, then combine for a simple overall score.
			// Depending on length and weight, we might just evaluate "title + body".
			combinedText := post.Title + " " + post.Body
			score, _ := s.EvaluateText(combinedText)

			// VADER compound score is -1.0 to 1.0.
			// We need to map this to 0.0 to 100.0.
			// Formula: (score + 1.0) / 2.0 * 100.0
			normalizedScore := (score + 1.0) / 2.0 * 100.0

			totalScore += normalizedScore
			count++
		}
	}

	if count == 0 {
		return 50.0 // Default neutral score if no posts match
	}

	return totalScore / float64(count)
}
