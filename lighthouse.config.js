/**
 * Lighthouse CI Configuration
 * @see https://github.com/GoogleChrome/lighthouse-ci
 */
export default {
  ci: {
    collect: {
      url: [
        'https://eedhalal.com/',
        'https://eedhalal.com/popular-menu.html',
        'https://eedhalal.com/order-steps.html',
        'https://eedhalal.com/corporate.html',
        'https://eedhalal.com/contact.html'
      ],
      numberOfRuns: 3,
      startServerCommand: 'npm run public:serve',
      startServerReadyPattern: 'Server running',
      startServerReadyTimeout: 30000
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
        'render-blocking-resources': ['error', { maxLength: 0 }],
        'uses-optimized-images': 'warn',
        'uses-webp-images': 'warn',
        'unsized-images': 'warn'
      }
    },
    upload: {
      target: 'lhci',
      serverBaseUrl: process.env.LHCI_SERVER_URL || '',
      token: process.env.LHCI_BUILD_TOKEN || ''
    }
  }
};