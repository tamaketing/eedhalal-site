# Project Rules

## Business Data Source of Truth

- `business-rules.json` is the single source of truth for all business rules and business data.
- Do not treat copied, rendered, translated, generated, or channel-specific content as the canonical source.
- Update `business-rules.json` first when changing any business rule or business data.

## Required Synchronization

- Never change business data in only one location.
- Before making a business-data change, search the entire repository for all related values, terms, identifiers, calculations, claims, and translations.
- Synchronize every affected representation so it remains consistent with `business-rules.json`.
- This requirement includes, but is not limited to:
  - Thai and English website content
  - JSON-LD structured data
  - SEO metadata and sitemaps
  - FAQs
  - Calculators and their formulas, labels, and outputs
  - `llms.txt`
  - `llms-full.md`
  - AI Knowledge content and datasets
  - LINE bot messages, flows, prompts, and data
  - n8n workflows, nodes, prompts, and data mappings
  - All other data files, generated content, integrations, and channel-specific copies

## Change Process

- Before editing, assess the impact of the change and identify every affected file, feature, channel, language, and integration.
- After editing, run all relevant existing tests, validation commands, builds, and/or linters available in the project.
- In the final summary, explicitly list every file changed and state which verification commands were run and their results.

## Content Preservation and SEO Evolution

- Preserve existing public-page content, internal links, useful search-intent coverage, media, reviews, and conversion paths unless the user explicitly asks to remove a specific item.
- Improve pages through targeted additions or replacements, not whole-page rewrites. Before removing material, identify its SEO, AI-discovery, and customer-journey impact.
- Keep legacy meal-box, menu, and calculator entry paths while adding catering content and clear service links.
- Review the diff and validate the page after every content change.
