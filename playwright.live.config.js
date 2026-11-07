import base from './playwright.config.js';

export default {
    ...base,
    testDir: './tests/live',
    outputDir: './test-results-live',
    timeout: 300_000,
    workers: 1,
    projects: [base.projects[0]],
};
