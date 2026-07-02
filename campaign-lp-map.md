# Campaign LP Map

Round 1 rule:
- Use the existing pages as LPs.
- Do not create new LP pages yet.
- Match ad creative to the existing page message first.

## Standard Mapping

- `HR / Procurement / Office Admin / Event Coordinator`
  - LP: [`corporate.html`](./corporate.html)
  - Angle: quotation-ready corporate meal boxes, 20+ boxes, document support, on-time delivery
  - Dedicated LP (Round 2): [`lp-corporate-meeting.html`](./lp-corporate-meeting.html)
  - Angle: hyper-targeted to HR/procurement pain points — quotation, procurement documents, on-time delivery, budget control, menu variety. No catering/no single-order noise.

- `Event / Catering / Banquet / Family`
  - LP: [`catering.html`](./catering.html)
  - Angle: halal catering, buffet, yok mor, event presentation

- `Menu Browsers / Price Comparers / Warm Leads`
  - LP: [`popular-menu.html`](./popular-menu.html)
  - Angle: see popular menu first, compare price quickly, ask for quote after browsing

- `Geo / Sathorn`
  - LP: [`sathorn.html`](./sathorn.html)

- `Geo / Silom`
  - LP: [`silom.html`](./silom.html)

- `Geo / Sathorn-Silom` (combined)
  - LP: [`sathorn-silom.html`](./sathorn-silom.html)

- `Geo / Sukhumvit`
  - LP: [`sukhumvit.html`](./sukhumvit.html)

- `Geo / Rama 3`
  - LP: [`rama3.html`](./rama3.html)

- `Geo / Ladprao`
  - LP: [`ladprao.html`](./ladprao.html)

## UTM Naming

- Template: `utm_source={meta|google}&utm_medium=paid&utm_campaign={audience}_{offer}&utm_content={creative_id}&utm_term={adset_id}`
- `utm_source`: use `meta` for Meta ads and `google` for Google ads
- `utm_medium`: always `paid`
- `utm_campaign`: combine the audience label and offer angle
- `utm_content`: creative ID or creative variant
- `utm_term`: ad set ID

Examples:

```text
https://eedhalal.com/corporate.html?utm_source=meta&utm_medium=paid&utm_campaign=corporate_20plus&utm_content=creative_101&utm_term=adset_hr_01
https://eedhalal.com/catering.html?utm_source=meta&utm_medium=paid&utm_campaign=catering_100_500plus&utm_content=creative_202&utm_term=adset_event_01
https://eedhalal.com/popular-menu.html?utm_source=google&utm_medium=paid&utm_campaign=popularmenu_start89&utm_content=creative_303&utm_term=adset_menu_01
https://eedhalal.com/sathorn.html?utm_source=google&utm_medium=paid&utm_campaign=geo_sathorn&utm_content=creative_404&utm_term=adset_geo_sathorn_01
https://eedhalal.com/silom.html?utm_source=google&utm_medium=paid&utm_campaign=geo_silom&utm_content=creative_405&utm_term=adset_geo_silom_01
https://eedhalal.com/sathorn-silom.html?utm_source=google&utm_medium=paid&utm_campaign=geo_sathorn_silom&utm_content=creative_406&utm_term=adset_geo_ss_01
https://eedhalal.com/sukhumvit.html?utm_source=google&utm_medium=paid&utm_campaign=geo_sukhumvit&utm_content=creative_407&utm_term=adset_geo_sukhumvit_01
https://eedhalal.com/rama3.html?utm_source=google&utm_medium=paid&utm_campaign=geo_rama3&utm_content=creative_408&utm_term=adset_geo_rama3_01
https://eedhalal.com/ladprao.html?utm_source=google&utm_medium=paid&utm_campaign=geo_ladprao&utm_content=creative_409&utm_term=adset_geo_ladprao_01
```

## Notes

- The site already emits `lp_slug`, `lp_audience`, `lp_intent`, and UTM fields in tracking events.
- If a campaign needs a tighter message match later, create a new LP only after the audience/page fit is validated.
