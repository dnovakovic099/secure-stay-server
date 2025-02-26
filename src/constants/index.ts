export const AIR_DNA_URL = "https://app.airdna.co/data/login";

export const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15",
];

export const PUPPETEER_LAUNCH_OPTIONS = {
  headless: false, // set to false to open the browser
  args: [
    "--disable-setuid-sandbox",
    "--no-sandbox",
    "--allow-file-access-from-files",
    "--enable-local-file-accesses",
    "--enable-gpu",
    "--font-render-hinting=none",
    "--force-color-profile=srgb",
  ],
  defaultViewport: null,
};

export const PROPERTY_REVENUE_REPORT_PATH =
  "src/template/listing/propertyPerformanceReport/index.ejs";

const PUBLIC_URL = `${process.env.BASE_URL}/public`;
export const LOGO_WHITE_URL = `${PUBLIC_URL}/logo-white.png`;
export const LOGO_URL = `${PUBLIC_URL}/logo.png`;
export const NEW_LOGO_WHITE = `${PUBLIC_URL}/new-white-logo.png`;
export const NEW_LOGO = `${PUBLIC_URL}/new-logo.png`;
export const MAC_BOOK_IMAGE = `${PUBLIC_URL}/mac-book.png`;
export const REVENUE_ICONS = `${PUBLIC_URL}/revenue-icons.png`;
export const BORDER_IMAGE = `${PUBLIC_URL}/image-border.png`;
export const OVERLAY_IMAGE = `${PUBLIC_URL}/image-overlay.png`;
export const PAGE_1_IMAGE = `${PUBLIC_URL}/page-1-image.png`;
export const PAGE_2_IMAGE = `${PUBLIC_URL}/page-2-image.jpg`;
export const PAGE_3_IMAGE = `${PUBLIC_URL}/page-3-image.jpg`;
export const PAGE_4_IMAGE = `${PUBLIC_URL}/page-4-image.jpg`;
export const PAGE_4_CARD_1 = `${PUBLIC_URL}/page-4-card-1.jpg`;
export const PAGE_4_CARD_2 = `${PUBLIC_URL}/page-4-card-2.jpg`;
export const PAGE_4_CARD_3 = `${PUBLIC_URL}/page-4-card-3.jpg`;
export const PAGE_6_IMG_1 = `${PUBLIC_URL}/page-6-1.jpg`;
export const PAGE_7_IMG_1 = `${PUBLIC_URL}/page-7-1.jpg`;
export const PAGE_7_IMG_2 = `${PUBLIC_URL}/page-7-2.jpg`;
export const PAGE_9_IMG = `${PUBLIC_URL}/page-9.jpg`;
export const PAGE_10_IMG = `${PUBLIC_URL}/page-10.jpg`;
export const PAGE_12_IMG = `${PUBLIC_URL}/page-12.jpg`;
export const PAGE_14_IMG = `${PUBLIC_URL}/page-14.jpg`;
export const BG_SECTION_IMAGE = `${PUBLIC_URL}/bg-section-image.jpg`;

export const PORTFOLIO_IMAGES = Array.from(
  { length: 15 },
  (_, i) => `${PUBLIC_URL}/portfolio${i + 1}.png`
);

export const ICON_GEARS = `${PUBLIC_URL}/icon-gears.png`;
export const ICON_DOLLAR_CHART = `${PUBLIC_URL}/icon-dollar-chart.png`;
export const ICON_HAND_HOLDIING_USERS = `${PUBLIC_URL}/icon-hand-holding-users.png`;
export const ICON_USER_STARS = `${PUBLIC_URL}/icon-user-stars.png`;
