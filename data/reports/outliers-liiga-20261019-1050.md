# Outlier rule backtest: SM-liiga

3292 stored games over 8 seasons (20192020–20262027), 644 with prices, 1286 game-markets with at least 3 books, 21 distinct books. Candidates: every book. Rule: one flat unit on each (game, side) whose best candidate price exceeds 1 / (p_cons − α), p_cons = 1 / mean odds across the books.

## α sweep

| α | Market | Bets | Hit | Expected hit | Mean odds | P&L | Yield | ± se | Sharp expectation |
|---|---|---|---|---|---|---|---|---|---|
| 0.02 | all | 1341 | 37.5 % | 39.4 % | 3.04 | -52.3 | -3.9 % | 3.8 % | +0.3 % |
| 0.02 | moneyline | 63 | 49.2 % | 51.0 % | 2.13 | -5.2 | -8.3 % | 12.5 % | -1.8 % |
| 0.02 | regulation | 1278 | 36.9 % | 38.9 % | 3.08 | -47.1 | -3.7 % | 3.9 % | +0.4 % |
| 0.03 | all | 550 | 42.4 % | 42.3 % | 2.72 | 3.0 | +0.6 % | 5.4 % | +1.3 % |
| 0.03 | moneyline | 6 | 66.7 % | 55.1 % | 1.89 | 1.2 | +20.7 % | 39.1 % | +1.8 % |
| 0.03 | regulation | 544 | 42.1 % | 42.1 % | 2.73 | 1.8 | +0.3 % | 5.5 % | +1.3 % |
| 0.04 | all | 145 | 44.1 % | 45.6 % | 2.47 | -1.5 | -1.0 % | 10.0 % | +2.5 % |
| 0.04 | moneyline | 3 | 66.7 % | 52.2 % | 1.99 | 0.5 | +17.3 % | 58.9 % | +6.7 % |
| 0.04 | regulation | 142 | 43.7 % | 45.5 % | 2.48 | -2.0 | -1.4 % | 10.1 % | +2.4 % |
| 0.05 | all | 25 | 56.0 % | 55.7 % | 1.94 | 0.3 | +1.2 % | 19.1 % | +1.9 % |
| 0.05 | regulation | 25 | 56.0 % | 55.7 % | 1.94 | 0.3 | +1.2 % | 19.1 % | +1.9 % |
| 0.06 | all | 4 | 75.0 % | 48.5 % | 2.09 | 2.3 | +58.3 % | 53.9 % | +3.3 % |
| 0.06 | regulation | 4 | 75.0 % | 48.5 % | 2.09 | 2.3 | +58.3 % | 53.9 % | +3.3 % |
| 0.07 | all | 0 | – | – | – | 0.0 | – | – | – |
| 0.08 | all | 0 | – | – | – | 0.0 | – | – | – |

Expected hit = mean(p_cons − α) over the bets, the paper's accuracy forecast. Sharp expectation = mean(p_sharp × odds − 1), with p_sharp the de-vigged sharp price stored with the game (consensus, pinnacle, avg): positive means the sharp price also calls the bet value; negative means the outlier is the book's own opinion or a stale line.

## α = 0.05 in detail (25 bets)

### By season

| Group | Bets | Hit | Expected hit | Mean odds | P&L | Yield | ± se | Sharp expectation |
|---|---|---|---|---|---|---|---|---|
| 20252026 | 19 | 57.9 % | 59.7 % | 1.77 | 0.0 | +0.2 % | 21.0 % | +0.9 % |
| 20262027 | 6 | 50.0 % | 42.8 % | 2.46 | 0.3 | +4.7 % | 47.4 % | +5.1 % |

### By market and side

| Group | Bets | Hit | Expected hit | Mean odds | P&L | Yield | ± se | Sharp expectation |
|---|---|---|---|---|---|---|---|---|
| regulation home | 15 | 60.0 % | 58.5 % | 1.83 | 1.1 | +7.5 % | 24.5 % | +1.4 % |
| regulation away | 10 | 50.0 % | 51.5 % | 2.10 | -0.8 | -8.2 % | 31.7 % | +2.5 % |

### By book

| Group | Bets | Hit | Expected hit | Mean odds | P&L | Yield | ± se | Sharp expectation |
|---|---|---|---|---|---|---|---|---|
| coolbet | 23 | 60.9 % | 56.2 % | 1.90 | 2.3 | +10.0 % | 19.7 % | +1.4 % |
| leovegas_se | 2 | 0.0 % | 49.1 % | 2.39 | -2.0 | -100.0 % | 0.0 % | +7.8 % |

