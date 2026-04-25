/**
 * Lighthouse CI Configuration
 * @see https://github.com/GoogleChrome/lighthouse-ci
 */
export default {
  ci: {
    collect: {
      staticDistDir: './_site',
      url: [
        'http://localhost/',
        'http://localhost/popular-menu.html',
        'http://localhost/order-steps.html',
        'http://localhost/corporate.html',
        'http://localhost/contact.html'
      ],
      numberOfRuns: 3,
      settings: {
        chromeFlags: '--no-sandbox'
      }
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        'categories:seo': ['error', { minScore: 0.9 }],
        'first-contentful-paint': ['warn', { maxNumericValue: 2000 }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 4000 }],
        'cumulative-layout-shift': ['warn', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['warn', { maxNumericValue: 500 }],
        'unused-javascript': ['warn', { maxLength: 0 }],
        'uses-long-cache-ttl': ['warn', { maxAssetLength: 0 }],
        'render-blocking-resources': 'warn',
        'uses-optimized-images': 'warn',
        'uses-webp-images': 'warn',
        'unsized-images': 'warn'
      }
    },
    upload: {
      target: 'temporary-public-storage'
    }
  }
};
