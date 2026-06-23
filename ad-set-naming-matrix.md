# Ad Set Naming Matrix

Use these names consistently in Meta Ads Manager and Google Ads so the CSV exports can be joined back to report results.

## Convention

- Campaign name: `EEDHALAL_{platform}_{audience}_{offer}`
- Meta uses `campaign_name`
- Google uses `campaign`
- Shared audience key: `ad_set_name` / `ad_group`
- Creative ID should map 1:1 to each row in `campaign-ad-copy.md`
- For analysis, join on `ad_set_name` plus `creative_id`

## Matrix

| Segment | LP | Campaign name example | Shared ad set / ad group | Creative ID | lp_audience | lp_intent |
|---|---|---|---|---|---|---|
| Corporate | `corporate.html` | `EEDHALAL_{platform}_CORPORATE_20PLUS` | `adset_hr_01` | `creative_101` | `corporate` | `hr-procurement` |
| Catering | `catering.html` | `EEDHALAL_{platform}_CATERING_100_500PLUS` | `adset_event_01` | `creative_202` | `catering` | `event-catering` |
| Popular menu | `popular-menu.html` | `EEDHALAL_{platform}_POPULARMENU_START89` | `adset_menu_01` | `creative_303` | `popular-menu` | `price-comparison` |
| Geo: สาทร-สีลม | `sathorn-silom.html` | `EEDHALAL_{platform}_GEO_SATHORN_SILOM` | `adset_geo_ss_01` | `creative_404` | `sathorn-silom` | `local-delivery` |
| Geo: สุขุมวิท | `sukhumvit.html` | `EEDHALAL_{platform}_GEO_SUKHUMVIT` | `adset_geo_sukhumvit_01` | `creative_405` | `sukhumvit` | `local-delivery` |
| Geo: พระราม 3 | `rama3.html` | `EEDHALAL_{platform}_GEO_RAMA3` | `adset_geo_rama3_01` | `creative_406` | `rama3` | `local-delivery` |
| Geo: ลาดพร้าว | `ladprao.html` | `EEDHALAL_{platform}_GEO_LADPRAO` | `adset_geo_ladprao_01` | `creative_407` | `ladprao` | `local-delivery` |

## Join Notes

- `ad-set-naming-matrix.md` is the source of truth for mapping.
- `campaign_name` and `campaign` remain platform-specific in the CSV exports.
- `ad_set_name` and `ad_group` are the stable cross-platform keys.
- Location work is split into 4 geo ad sets, one per local LP.
