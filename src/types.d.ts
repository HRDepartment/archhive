export interface ArchhiveOptions {
    print: boolean;
    width: string;
    screenshot: 'fullpage' | 'stitched' | 'none';
    screenshotQuality: number;
    aoUrl: string | 'auto';
    atUrl: string | 'auto';
    stylesheet?: string;
    stylesheetsDir: string;
    filters?: string;
    shorturl?: string;
    exifComment?: string;
    exifKeywords?: string;
    renew: 'auto' | 'manual' | 'no';
    referrer?: string;
    outputDir: string;
    noscript: boolean;
    imageLoadTimeout: number;
    debug?: 'all' | 'screenshot';
    url: string;
}

export interface TaskContext {
    prompt?: typeof import('enquirer').prompt;
    log?(...text: any[]): void;
    opts: ArchhiveOptions;
    browser: any;
    urls: any;
    stylesheet?: string;
    filename: string;
    pageTitle: string;
}

export type Task = (import('listr').ListrTaskWrapper<TaskContext>); 