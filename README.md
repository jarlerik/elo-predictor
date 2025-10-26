## Asennus

1. `npm install`
2. Kehityskäyttöön: `npm run dev`
3. Tai build + start:

- `npm run build`
- `npm start`

Palvelin käynnistyy oletuksena porttiin 3000.

## Endpoints

- `GET /teams` — palauttaa laskettujen joukkueiden ELO-arvot
- `GET /predict?home=BOS&away=TOR` — palauttaa todennäköisyydet JSONissa

Huom: NHL-otteluissa lopullinen tasapeli ei ole tulos (OT/SO ratkaisee), joten `drawProbability` palautetaan 0.0 tässä versiossa.
