import { ElementHandle, Page } from "puppeteer";
import { IListingPageElementData, LoginCredentials } from "../types";
import { AIR_DNA_URL, USER_AGENTS } from "../constants";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

export const login = async (page: Page, credentials: LoginCredentials) => {
  try {
    await page.goto(AIR_DNA_URL);
    await page.type('input[name="email"]', credentials.email);
    await page.type('input[name="password"]', credentials.password);
    await page.click('button[type="submit"]');
    return true;
  } catch (error) {
    console.error("Login failed:", error);
    throw new Error("Unable to log in to AirDNA");
  }
};

export const generateRandomUA = () => {
  const randomUAIndex = Math.floor(Math.random() * USER_AGENTS.length);

  return USER_AGENTS[randomUAIndex];
};

export const setBedBathGuestCounts = async (
  page: Page,
  params: {
    guests: string;
    baths: string;
    beds: string;
  }
) => {
  const { guests, baths, beds } = params;
  const responseData = {
    success: false,
    data: null,
  };
  try {
    const selectValueFromDropdown = async (
      value: string,
      dropdownSelector: string
    ) => {
      const dropdown = await page.$(dropdownSelector);
      if (!dropdown) {
        throw new Error(`Dropdown not found for selector: ${dropdownSelector}`);
      }
      await dropdown.click();

      const optionSelector = `ul[role="listbox"] li[data-value="${value}"]`;
      await page.waitForSelector(optionSelector, { visible: true });

      await page.click(optionSelector);
    };

    await selectValueFromDropdown(
      beds,
      ".MuiInputBase-root.MuiOutlinedInput-root.MuiInputBase-colorPrimary.css-1y3n7y9:nth-of-type(1)"
    );
    await selectValueFromDropdown(
      baths,
      ".MuiInputBase-root.MuiOutlinedInput-root.MuiInputBase-colorPrimary.css-1y3n7y9:nth-of-type(2)"
    );
    await selectValueFromDropdown(
      guests,
      ".MuiInputBase-root.MuiOutlinedInput-root.MuiInputBase-colorPrimary.css-1y3n7y9:nth-of-type(3)"
    );

    const updateButtonSelector = ".css-1mr4j7o";
    const updateButton = await page.$(updateButtonSelector);

    updateButton.click();

    // Wait for the API call to be made and check the response status
    const response = await page.waitForResponse(
      (resp) =>
        resp.url() ===
          "https://api.airdna.co/api/explorer/v1/rentalizer/estimate/full" &&
        resp.request().method() !== "OPTIONS" &&
        resp.status() === 200
    );
    if (!response.ok()) {
      throw new Error(`Response failed with status: ${response.status()}`);
    }
    // Extract the response body data
    const data = await response.json();
    responseData.success = true;
    responseData.data = data;
  } catch (error) {
    console.error("Error getting listing counts:", error);
    throw new Error("Failed to retrieve beds, baths, or guests count");
  }
  return responseData;
};

export const scrapeAllDataFromSelectedListing = async (page: Page) => {
  return await page.evaluate(() => {
    const elements = Array.from(
      document.querySelectorAll(".MuiTypography-root")
    );

    // Group elements by their parent node
    const groupedByParent = elements.reduce((groups, element) => {
      const parent = element.parentNode as Element; // Explicitly cast parentNode to Element

      if (!parent) return groups; // Skip elements without a parent

      // Use the parent's unique identifier (e.g., tagName + className) as a key
      const parentKey = `${parent.tagName}-${parent.className}`;

      if (!groups[parentKey]) {
        groups[parentKey] = [];
      }
      groups[parentKey].push(element);

      return groups;
    }, {} as Record<string, Element[]>);

    // Transform grouped elements into segregated objects
    return Object.entries(groupedByParent).map(([parentKey, elements]) => ({
      parent: parentKey,
      children: elements.map((child) => ({
        tagName: child.tagName,
        className: child.className,
        id: child.id,
        text: child.textContent?.trim() || "",
      })),
    }));
  });
};
export const transformData = (data: IListingPageElementData[]) => {
  const transformedData = {
    amenities: [],
    listings: [],
    revenueDetails: [],
    propertyDetails: [],
    otherSections: [],
  };

  if (!data.length) return transformData;

  data.forEach((item) => {
    const parentClass = item.parent;

    // Process based on parent class patterns
    if (parentClass.includes("css-es5gl7")) {
      // Amenities section
      item.children.forEach((child, index) => {
        if (index % 2 === 0) {
          transformedData.amenities.push({
            amenity: child.text,
            percentage: item.children[index + 1]?.text || "N/A",
          });
        }
      });
    } else if (parentClass.includes("css-7zjnja")) {
      // Listings section
      item.children.forEach((child) => {
        transformedData.listings.push({
          description: child.text,
        });
      });
    } else if (parentClass.includes("css-1abrbpw")) {
      // Revenue details
      let currentRevenue = {};
      item.children.forEach((child, index) => {
        if (index % 2 === 0) {
          currentRevenue = {
            title: child.text,
            value: item.children[index + 1]?.text || "N/A",
          };
          transformedData.revenueDetails.push(currentRevenue);
        }
      });
    } else if (parentClass.includes("css-1hqz9cp")) {
      // Property details
      item.children.forEach((child) => {
        transformedData.propertyDetails.push({
          label: child.text.includes(":") ? child.text.replace(":", "") : null,
          value: child.text.includes(":") ? null : child.text,
        });
      });
    } else {
      // Generic catch-all for unmapped sections
      transformedData.otherSections.push({
        parent: parentClass,
        children: item.children.map((child) => ({
          tagName: child.tagName,
          className: child.className,
          text: child.text,
        })),
      });
    }
  });

  return transformedData;
};

export const takeScreenShots = async (page: Page, listingLink?: string) => {
  const screenshotsDir = path.join("public");
  const sessionId = randomUUID();
  const sessionDir = path.join(screenshotsDir, sessionId);

  const selectors = listingLink
    ? {
        listingNameAndDesc: ".MuiBox-root.css-17bq4g2",
        listingRevenues: ".MuiBox-root.css-13vcxc6",
      }
    : {
        revenueGraph: ".recharts-responsive-container",
        propertyStatisticsGraph: ".MuiBox-root.css-1czpbid",
        nearbyPropertyListings: ".MuiBox-root.css-qebjua",
        marketTypeLink:
          ".MuiTypography-root.MuiTypography-inherit.MuiLink-root.MuiLink-underlineAlways.css-1a9leff",
        allListingLink:
          ".MuiButtonBase-root.MuiTab-root.MuiTab-textColorPrimary.css-1gul72i",
        occupancySection: ".MuiBox-root.css-1loy98s",
        // occupanyChart: ".MuiBox-root.css-68ddzu",
      };

  // Helper to take a screenshot for a given selector
  const takeScreenshot = async (
    element: ElementHandle<Element>,
    imageName: string
  ): Promise<string | null> => {
    try {
      // await page.waitForSelector(selector, { timeout: 5000 });
      // const element = await page.$(selector);
      if (element) {
        const screenshotBuffer = await element.screenshot({
          encoding: "binary",
        });

        // Ensure the session directory exists
        if (!fs.existsSync(sessionDir)) {
          fs.mkdirSync(sessionDir, { recursive: true });
        }

        const filePath = path.join(sessionDir, `${imageName}.png`);
        fs.writeFileSync(filePath, screenshotBuffer);
        return filePath; // Return the file path
      }
    } catch (error) {
      console.error(
        `Failed to take screenshot for selector: ${element}`,
        error
      );
    }
    return null;
  };

  // Helper to click a link and wait for navigation or idle state
  const clickAndWait = async (selector: string) => {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      const link = await page.$(selector);
      if (link) {
        await link.click();
        await page.waitForNetworkIdle();
      } else {
        throw new Error(`Unable to find selector: ${selector}`);
      }
    } catch (error) {
      console.error(`Error clicking on selector: ${selector}`, error);
    }
  };

  // Capture screenshots
  const screenShots = listingLink
    ? {
        listingNameAndDescSS: null,
        listingRevenuesSS: null,
        listingRatingText: null,
      }
    : {
        revenueGraphSS: null,
        averageMonthlyOccupancyChartSS: null,
        propertyStatisticsGraphSS: null,
        occupancySectionSS: null,
        nearbyPropertyLisingSS: null,
      };

  try {
    if (listingLink) {
      const imageUrls2 = await page.$$eval(
        ".MuiBox-root.css-1ibmiuh img",
        (images) => {
          return images.map((img) => img.src);
        }
      );

      const imageUrls3 = await page.evaluate(() => {
        const specificContainer = document.querySelector(
          ".MuiBox-root.css-tw6u9"
        );

        if (!specificContainer) return [];

        const images = specificContainer.querySelectorAll(
          ".MuiBox-root.css-b7jmoi img"
        );
        return Array.from(images).map((img) => (img as HTMLImageElement).src);
      });

      if ((imageUrls3.length = 0)) {
        throw new Error("No images found in the listing");
      }

      // // Download each image using axios
      // for (let i = 0; i < 5; i++) {
      //   const url = imageUrls3[i];
      //   await downloadImage(url, `image-${i + 1}`);
      // }

      screenShots.listingRatingText = await page.evaluate(() => {
        const container = document.querySelector(".MuiBox-root.css-k008qs");
        if (!container) return null;

        // Get all child elements inside the container
        const elements = Array.from(container.children);

        // Check if there are any elements
        if (elements.length === 0) return null;

        // Get the last element and its text content
        const lastElement = elements[elements.length - 1];
        return lastElement.textContent.trim(); // Trim whitespace and return text
      });

      const listingNameAndDesc = await page.$(selectors.listingNameAndDesc);
      await page.waitForSelector(selectors.listingNameAndDesc);
      screenShots.listingNameAndDescSS = await takeScreenshot(
        listingNameAndDesc,
        "listingNameAndDescSS"
      );
      const listingRevenues = await page.$(selectors.listingRevenues);
      await page.waitForSelector(selectors.listingRevenues);
      screenShots.listingRevenuesSS = await takeScreenshot(
        listingRevenues,
        "listingRevenuesSS"
      );
    }

    // Step 2: Navigate to Market Type Section and Capture Screenshot
    await clickAndWait(selectors.marketTypeLink);
    await page.waitForSelector(selectors.propertyStatisticsGraph);
    const propertyStatSelc = await page.$(selectors.propertyStatisticsGraph);
    screenShots.propertyStatisticsGraphSS = await takeScreenshot(
      propertyStatSelc,
      "propertyStatisticsGraph"
    );

    await page.waitForSelector(".MuiBox-root.css-68ddzu");
    await page.waitForFunction(() => {
      const charts = document.querySelectorAll(".MuiBox-root.css-68ddzu");
      return charts.length > 9 && charts[9].clientHeight > 100; // Ensuring full render
    });
    const chartElements = await page.$$(".MuiBox-root.css-68ddzu");

    // const chartElements = await page.$$(".MuiBox-root.css-10klw3m");
    if (chartElements.length > 0) {
      await page.evaluate(
        (el) => el.scrollIntoView({ behavior: "smooth", block: "center" }),
        chartElements[9]
      );
      screenShots.averageMonthlyOccupancyChartSS = await takeScreenshot(
        chartElements[9], // 0 for occupancy and 9 for ADR chart
        "averageMonthlyOccupancyChart"
      );

      screenShots.revenueGraphSS = await takeScreenshot(
        chartElements[5],
        "revenueGraph"
      );
    }
    const occupancySelec = await page.$(selectors.occupancySection);
    await page.waitForSelector(selectors.occupancySection);
    screenShots.occupancySectionSS = await takeScreenshot(
      occupancySelec,
      "occupancySection"
    );

    // Step 3: Navigate to All Listings Section and Capture Screenshot

    const elements = await page.$$(selectors.allListingLink);
    if (elements.length > 0) {
      await elements[2].click();
      await page.waitForNetworkIdle();
    } else {
      throw new Error(`No element found at index 3 for nearbyPropertyListings`);
    }
    await page.waitForSelector(selectors.nearbyPropertyListings);
    const nearbyPropertySelec = await page.$(selectors.nearbyPropertyListings);

    screenShots.nearbyPropertyLisingSS = await takeScreenshot(
      nearbyPropertySelec,
      "nearbyPropertyListings"
    );
  } catch (error) {
    console.error("Error taking screenshots:", error);
  }

  return { screenshotSessionId: sessionId, screenShots };
};

export const imageToBase64 = (imagePath: string): string => {
  const file = fs.readFileSync(imagePath);
  return `data:image/jpeg;base64,${file.toString("base64")}`;
};

export const calculatingTotalProjectRevenue = (revenueRange: RevenueRange) => {
  const currentYear = new Date().getFullYear();
  const yearlyData = revenueRange[currentYear.toString()];

  let totalClient = 0;
  let totalMarketAvg = 0;
  let totalCompetitor = 0;

  Object.entries(yearlyData).forEach(([month, data]) => {
    const client = data.lower;
    const marketAvg = (data.upper + data.lower) / 2;
    const competitor = data.upper;
    totalClient += client;
    totalMarketAvg += marketAvg;
    totalCompetitor += competitor;
  });
  return {
    totalClient,
    totalMarketAvg,
    totalCompetitor,
  };
};
