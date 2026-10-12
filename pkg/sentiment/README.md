# pkg/sentiment

The `pkg/sentiment` module provides local VADER sentiment analysis using `github.com/jonreiter/govader`, enhanced with a custom financial lexicon to evaluate text and compute retail momentum scores.

```mermaid
graph TD
    RedditProvider[pkg/sentiment/provider.go: RedditProvider] --> SentimentAnalyzer[pkg/sentiment/scorer.go: SentimentAnalyzer]
    RedditProvider --> FeatureProvider[pkg/data/feature.go: FeatureProvider Interface]
    SentimentAnalyzer --> govader[github.com/jonreiter/govader]
```
