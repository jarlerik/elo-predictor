import React, { useState } from "react";

const KellyBet: React.FC = () => {
  const [probability, setProbability] = useState<string>("");
  const [odds, setOdds] = useState<string>("");
  const [kellyDivider, setKellyDivider] = useState<string>("1");
  const [kellyPercentage, setKellyPercentage] = useState<number | null>(null);
  const [error, setError] = useState<string>("");

  const calculateKellyBet = () => {
    setError("");

    const prob = parseFloat(probability);
    const oddsValue = parseFloat(odds);
    const divider = parseFloat(kellyDivider);

    // Validation
    if (isNaN(prob) || isNaN(oddsValue) || isNaN(divider)) {
      setError("Please enter valid numbers");
      return;
    }

    if (prob <= 0 || prob >= 1) {
      setError("Probability must be between 0 and 1");
      return;
    }

    if (oddsValue <= 0) {
      setError("Odds must be greater than 0");
      return;
    }

    if (divider < 1 || divider > 10) {
      setError("Kelly divider must be between 1 and 10");
      return;
    }

    // Kelly criterion formula: f* = (bp - q) / b
    // Where: b = odds, p = probability of win, q = probability of loss (1-p)
    const q = 1 - prob;
    const kellyFraction = (oddsValue * prob - q) / oddsValue;

    // Apply Kelly divider for fractional Kelly
    const fractionalKelly = kellyFraction / divider;

    // Convert to percentage
    const kellyPercent = fractionalKelly * 100;

    if (kellyPercent < 0) {
      setError("Negative Kelly value - this bet has negative expected value");
      setKellyPercentage(null);
    } else if (kellyPercent > 100) {
      setError(
        "Kelly value exceeds 100% - consider using a higher Kelly divider"
      );
      setKellyPercentage(kellyPercent);
    } else {
      setKellyPercentage(kellyPercent);
    }
  };

  const clearInputs = () => {
    setProbability("");
    setOdds("");
    setKellyDivider("1");
    setKellyPercentage(null);
    setError("");
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Kelly Betting Calculator</h1>
        <p>Calculate optimal bet size using the Kelly criterion</p>
      </div>

      <div className="kelly-section">
        <div className="kelly-form">
          <div className="form-group">
            <label htmlFor="probability">Win Probability</label>
            <div className="input-group">
              <input
                id="probability"
                type="number"
                step="0.01"
                min="0.01"
                max="0.99"
                value={probability}
                onChange={(e) => setProbability(e.target.value)}
                placeholder="0.60"
                className="kelly-input"
              />
              <span className="input-suffix">(0.01 - 0.99)</span>
            </div>
            <small className="input-help">
              Enter probability as decimal (e.g., 0.60 for 60%)
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="odds">Decimal Odds</label>
            <div className="input-group">
              <input
                id="odds"
                type="number"
                step="0.01"
                min="1.01"
                value={odds}
                onChange={(e) => setOdds(e.target.value)}
                placeholder="2.50"
                className="kelly-input"
              />
              <span className="input-suffix">(1.01+)</span>
            </div>
            <small className="input-help">
              Enter decimal odds (e.g., 2.50 for +150 American odds)
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="kellyDivider">Kelly Divider</label>
            <div className="input-group">
              <select
                id="kellyDivider"
                value={kellyDivider}
                onChange={(e) => setKellyDivider(e.target.value)}
                className="kelly-select"
              >
                <option value="1">1 (Full Kelly)</option>
                <option value="2">2 (Half Kelly)</option>
                <option value="3">3 (Third Kelly)</option>
                <option value="4">4 (Quarter Kelly)</option>
                <option value="5">5 (Fifth Kelly)</option>
                <option value="6">6</option>
                <option value="7">7</option>
                <option value="8">8</option>
                <option value="9">9</option>
                <option value="10">10 (Tenth Kelly)</option>
              </select>
            </div>
            <small className="input-help">
              Lower values = higher risk, higher values = lower risk
            </small>
          </div>

          <div className="form-actions">
            <button onClick={calculateKellyBet} className="calculate-button">
              Calculate Kelly Bet
            </button>
            <button onClick={clearInputs} className="clear-button">
              Clear
            </button>
          </div>
        </div>

        {error && (
          <div className="kelly-error">
            <span className="error-icon">⚠️</span>
            {error}
          </div>
        )}

        {kellyPercentage !== null && !error && (
          <div className="kelly-result">
            <div className="result-header">
              <h3>Optimal Bet Size</h3>
              <span className="result-percentage">
                {kellyPercentage.toFixed(2)}%
              </span>
            </div>

            <div className="result-details">
              <div className="detail-item">
                <span className="detail-label">Bet Amount:</span>
                <span className="detail-value">
                  {kellyPercentage.toFixed(2)}% of bankroll
                </span>
              </div>

              <div className="detail-item">
                <span className="detail-label">Kelly Type:</span>
                <span className="detail-value">
                  {kellyDivider === "1"
                    ? "Full Kelly"
                    : `${kellyDivider}x Kelly`}
                </span>
              </div>

              <div className="detail-item">
                <span className="detail-label">Expected Value:</span>
                <span className="detail-value">
                  {(
                    (parseFloat(odds) * parseFloat(probability) - 1) *
                    100
                  ).toFixed(2)}
                  %
                </span>
              </div>

              <div className="detail-item">
                <span className="detail-label">Risk Level:</span>
                <span
                  className={`detail-value ${
                    kellyPercentage > 10
                      ? "high-risk"
                      : kellyPercentage > 5
                      ? "medium-risk"
                      : "low-risk"
                  }`}
                >
                  {kellyPercentage > 10
                    ? "High"
                    : kellyPercentage > 5
                    ? "Medium"
                    : "Low"}
                </span>
              </div>
            </div>

            <div className="kelly-info">
              <h4>Kelly Criterion Formula</h4>
              <p>
                <strong>f* = (bp - q) / b</strong>
              </p>
              <p>Where:</p>
              <ul>
                <li>
                  <strong>b</strong> = decimal odds
                </li>
                <li>
                  <strong>p</strong> = probability of winning
                </li>
                <li>
                  <strong>q</strong> = probability of losing (1-p)
                </li>
              </ul>
              <p className="disclaimer">
                <strong>Disclaimer:</strong> Kelly betting maximizes long-term
                growth but can be volatile. Fractional Kelly (using dividers
                &gt; 1) reduces risk and volatility while maintaining positive
                expected value.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default KellyBet;
