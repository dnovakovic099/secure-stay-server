import { ElementHandle, Page } from "puppeteer";
import { IListingPageElementData, LoginCredentials } from "../types";
import { AIR_DNA_URL, USER_AGENTS } from "../constants";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

export const login = async (page: Page, credentials: LoginCredentials) => {
  try {
    await page.goto(AIR_DNA_URL);
    const emailBtn = await page.$('.email-btn');
    if (!emailBtn) {
      throw new Error("Email button not found on the page.");
    }

    const isEmailBtnActive = await page.evaluate((btn) => {
      return btn.classList.contains('email-btn-active');
    }, emailBtn);
    if (!isEmailBtnActive) {
      await emailBtn.click();
    }

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

// Helper to take a screenshot for a given selector
const takeScreenshot = async (
  element: ElementHandle<Element>,
  imageName: string,
  sessionDir: string,
  chart = false,
  page: Page
): Promise<string | null> => {
  try {
    if (element) {
      if( imageName !== 'nearbyPropertyListings') {
      // Wait for element to be visible in viewport
      await element.evaluate((el) => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return new Promise((resolve) => setTimeout(resolve, 800));
      });
    }

      // Wait for all images and charts to fully load
      await element.evaluate((el) => {
        return new Promise((resolve) => {
          // Wait for all images to load
          const images = Array.from(el.querySelectorAll("img"));
          Promise.all(
            images.map((img) =>
              img.complete
                ? Promise.resolve()
                : new Promise((imgResolve) => img.addEventListener("load", imgResolve))
            )
          );

          // Wait for SVG elements (charts) to load
          const svgs = Array.from(el.querySelectorAll("svg"));
          if (svgs.length > 0) {
            setTimeout(resolve, 1000); // Extra time for SVG rendering
          } else {
            // Wait for element dimensions to stabilize
            let lastHeight = el.clientHeight;
            let lastWidth = el.clientWidth;
            let stabilityCount = 0;
            
            const checkDimensions = () => {
              if (el.clientHeight === lastHeight && el.clientWidth === lastWidth) {
                stabilityCount++;
                if (stabilityCount >= 3) { // Check if dimensions are stable for 3 consecutive checks
                  resolve(true);
                } else {
                  setTimeout(checkDimensions, 200);
                }
              } else {
                stabilityCount = 0;
                lastHeight = el.clientHeight;
                lastWidth = el.clientWidth;
                setTimeout(checkDimensions, 200);
              }
            };

            setTimeout(checkDimensions, 200);
          }
        });
      });

      // Add a final pause for rendering to complete
      await new Promise(resolve => setTimeout(resolve, 500));
      // Take screenshot with improved options
      const screenshotBuffer = await element.screenshot({
        encoding: "binary",
        captureBeyondViewport: true,
        omitBackground: false,
        type: 'png',
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
    console.error(`Failed to take screenshot for selector: ${element}`, error);
  }
  return null;
};

const applyFilterViaListing = async (page: Page, beds: string) => {
  try {
    // 1. Click Listings button
    const listingsButtonSelector = 'button.MuiButtonBase-root.MuiButton-root.MuiButton-text.MuiButton-textNeutral.MuiButton-sizeSmall.MuiButton-textSizeSmall.MuiButton-colorNeutral.css-1hga4oy';
    await page.waitForSelector(listingsButtonSelector);
    await page.click(listingsButtonSelector);

    // 2. Get all dropdowns
    const dropdowns = await page.$$('.MuiSelect-select.MuiSelect-outlined.MuiInputBase-input.MuiOutlinedInput-input.MuiInputBase-inputAdornedStart.css-1c3vwjf');

    // 3. Handle 3rd dropdown first (index 2)
    if (dropdowns.length > 2) {
      await dropdowns[2].focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector("ul[role='listbox']");
      const option2 = await page.$(`li[data-value='${beds}']`);
      if (option2) {
        await option2.click();  // Actually click the option!
        console.log("Option '2' selected for 3rd dropdown");
      }
      // Wait for dropdown to close
      await delay(1000);
    }

    // 4. Handle 4th dropdown (index 3)
    if (dropdowns.length > 3) {
      await dropdowns[3].focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector("ul[role='listbox']");
      const option3 = await page.$(`li[data-value='${beds}']`);
      if (option3) {
        await option3.click();
        console.log("Option '3' selected for 4th dropdown");
      }
      // Wait for dropdown to close
      await delay(1000);
    }



    const applyButtonSelector = 'button.MuiButtonBase-root.MuiButton-root.MuiButton-contained.MuiButton-containedNeutral.MuiButton-sizeMedium.MuiButton-containedSizeMedium.MuiButton-colorNeutral[type="submit"]';
    await page.waitForSelector(applyButtonSelector);
    const applyButton = await page.$(applyButtonSelector);
    await applyButton.click();
    return true;

  } catch (error) {
    console.error("Error applying filter via listing:", error);
    return false;
  }
};

export const takeScreenShots = async (page: Page, beds: string) => {
  const screenshotsDir = path.join("public");
  const sessionId = randomUUID();
  const sessionDir = path.join(screenshotsDir, sessionId);

  const selectors = {
    // revenueGraph: ".recharts-responsive-container",
    propertyStatisticsGraph: ".MuiBox-root.css-1czpbid",
    nearbyPropertyListings: ".MuiBox-root.css-qebjua",
    marketTypeLink:
      ".MuiTypography-root.MuiTypography-inherit.MuiLink-root.MuiLink-underlineAlways.css-1a9leff",
    allListingLink:
      ".MuiButtonBase-root.MuiTab-root.MuiTab-textColorPrimary.css-1gul72i",
    occupancySection: ".MuiBox-root.css-1loy98s",
    // occupanyChart: ".MuiBox-root.css-68ddzu",
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
  const screenShots = {
    revenueGraphSS: null,
    averageMonthlyOccupancyChartSS: null,
    propertyStatisticsGraphSS: null,
    occupancySectionSS: null,
    nearbyPropertyLisingSS: null,
  };

  try {
    // Step 2: Navigate to Market Type Section and Capture Screenshot
    await clickAndWait(selectors.marketTypeLink);

    await page.waitForNetworkIdle();

    await applyFilterViaListing(page, beds);

    await page.waitForNetworkIdle();

    await page.waitForSelector(selectors.propertyStatisticsGraph);
    const propertyStatSelc = await page.$(selectors.propertyStatisticsGraph);
    screenShots.propertyStatisticsGraphSS = await takeScreenshot(
      propertyStatSelc,
      "propertyStatisticsGraph",
      sessionDir,
      false,
      page
    );

    // await page.waitForSelector(".MuiBox-root.css-68ddzu");
    // await page.waitForFunction(() => {
    //   const charts = document.querySelectorAll(".MuiBox-root.css-68ddzu");
    //   return charts.length > 9 && charts[9].clientHeight > 200;
    // });
    // const chartElements = await page.$$(".MuiBox-root.css-68ddzu");

    // // const chartElements = await page.$$(".MuiBox-root.css-10klw3m");
    // if (chartElements.length > 9) {
    //   await page.evaluate(
    //     (el) => el.scrollIntoView({ behavior: "smooth", block: "center" }),
    //     chartElements[9]
    //   );
    //   delay(1500);
    //   screenShots.averageMonthlyOccupancyChartSS = await takeScreenshot(
    //     chartElements[9], // 0 for occupancy and 9 for ADR chart
    //     "averageMonthlyOccupancyChart",
    //     sessionDir,
    //     true
    //   );
    //   await chartElements[5].scrollIntoView();
    //   delay(1500);
    //   screenShots.revenueGraphSS = await takeScreenshot(
    //     chartElements[5],
    //     "revenueGraph",
    //     sessionDir,
    //     true
    //   );
    // }
    // const occupancySelec = await page.$(selectors.occupancySection);
    // await page.waitForSelector(selectors.occupancySection);
    // screenShots.occupancySectionSS = await takeScreenshot(
    //   occupancySelec,
    //   "occupancySection",
    //   sessionDir
    // );

    await page.waitForSelector(".MuiBox-root.css-1vx1dtt");
    const chartElements = await page.$$(".MuiBox-root.css-1vx1dtt");

    if (chartElements.length === 44) {
      const tabs = await page.$$('.MuiButtonBase-root.MuiTab-root.MuiTab-textColorPrimary.css-1gul72i');
      
      // Occupancy chart
      await tabs[5].click();
      await delay(3000);
      await waitForChartData(page, chartElements[16]);
      screenShots.averageMonthlyOccupancyChartSS = await takeScreenshot(
        chartElements[16],
        "averageMonthlyOccupancyChart", 
        sessionDir,
        true,
        page
      );
      
      // Revenue chart
      await tabs[6].click();
      await delay(3000);
      await waitForChartData(page, chartElements[25]);
      screenShots.revenueGraphSS = await takeScreenshot(
        chartElements[25],
        "revenueGraph",
        sessionDir,
        true,
        page
      );
    }

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

    delay(2000);

    screenShots.nearbyPropertyLisingSS = await takeScreenshot(
      nearbyPropertySelec,
      "nearbyPropertyListings",
      sessionDir,
      false,
      page
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

export const extractAirDnaListingId = (url: string) => {
  const decodedUrl = decodeURIComponent(url);
  const match = decodedUrl.match(/listing_id=([^&]+)/);
  return match ? match[1] : null;
};

export const getDataForSpecificListing = async (
  page: Page,
  listingUrl: string
) => {
  const responseData = {
    success: false,
    data: null,
  };
  try {
    const airBnbId = extractAirDnaListingId(listingUrl);
    console.log("airBnbId", airBnbId);

    if (!airBnbId) {
      throw new Error("The airBnb id is missing");
    }

    page.goto(listingUrl);

    const response = await page.waitForResponse((resp) => {
      const url = new URL(resp.url());
      return (
        url.pathname.includes(`/api/explorer/v1/listing/${airBnbId}`) &&
        !url.pathname.includes(`/comps`) &&
        resp.request().method() !== "OPTIONS" &&
        resp.status() === 200
      );
    }, { timeout: 60000 });

    if (!response.ok()) {
      throw new Error(`Response failed with status: ${response.status()}`);
    }
    // Extract the response body data
    const data = await response.json();
    responseData.success = true;
    responseData.data = data;
  } catch (error) {
    console.error("Failed to retrieve listing details from AirDNA API", error);
    throw new Error("Failed to retrieve listing details from AirDNA API");
  }
  return responseData;
};

export const extractImagesFromListingLink = async (page: Page) => {
  const screenshotsDir = path.join("public");
  const sessionId = randomUUID();
  console.log(sessionId);
  const sessionDir = path.join(screenshotsDir, sessionId);

  const selectors = {
    heroSection: ".MuiBox-root.css-17bq4g2",
    imgSection: ".MuiBox-root.css-9vp29i",
    statSection: ".MuiBox-root.css-13vcxc6",
  };

  try {
    await fs.promises.mkdir(sessionDir, { recursive: true });

    // Wait for the main container if it's a React app
    await page.waitForSelector(".MuiBox-root", { timeout: 10000 });

    for (const [key, selector] of Object.entries(selectors)) {
      try {
        // Check if the element exists
        const exists = await page.evaluate((sel) => !!document.querySelector(sel), selector);
        if (!exists) {
          console.warn(`Selector ${selector} not found.`);
          continue;
        }

        const element = await page.$(selector);
        if (element) {

          await takeScreenshot(element, key, sessionDir, false, page);
        } else {
          console.warn(`Element for ${key} not found.`);
        }
      } catch (error) {
        console.warn(`Error processing ${key}:`, error);
      }
    }

    return sessionId;
  } catch (error) {
    console.error("Error taking screenshots:", error);
  }

  return null;
};

export const extractImagesFromCompetitorListingLink = async (page: Page) => {
  const screenshotsDir = path.join("public");
  const sessionId = randomUUID();
  console.log(sessionId);
  const sessionDir = path.join(screenshotsDir, sessionId);

  const selectors = {
    heroSection: ".MuiBox-root.css-17bq4g2",
    imgSection: ".MuiBox-root.css-9vp29i",
    statSection: ".MuiBox-root.css-13vcxc6",
    marketSection: ".MuiBox-root.css-186n0wg"
  };

  try {
    await fs.promises.mkdir(sessionDir, { recursive: true });

    // Wait for the main container if it's a React app
    await page.waitForSelector(".MuiBox-root", { timeout: 10000 });

    for (const [key, selector] of Object.entries(selectors)) {
      try {
        // Check if the element exists
        const exists = await page.evaluate((sel) => !!document.querySelector(sel), selector);
        if (!exists) {
          console.warn(`Selector ${selector} not found.`);
          continue;
        }

        const element = await page.$(selector);
        if (element) {

          await takeScreenshot(element, key, sessionDir, false, page);
        } else {
          console.warn(`Element for ${key} not found.`);
        }
      } catch (error) {
        console.warn(`Error processing ${key}:`, error);
      }
    }

    return sessionId;
  } catch (error) {
    console.error("Error taking screenshots:", error);
  }

  return null;
};

function delay(time: number) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}

const waitForChartData = async (page: Page, el: ElementHandle<Element>) => {
  try {
    await page.evaluate((element) => {
      return new Promise((resolve) => {
        const checkForData = () => {
          // Look for SVG elements with data
          const circles = element.querySelectorAll('circle');
          const paths = element.querySelectorAll('path[d]');
          
          if (circles.length > 5 || paths.length > 2) {
            resolve(true);
          } else {
            setTimeout(checkForData, 500);
          }
        };
        
        checkForData();
      });
    }, el);
    
    return true;
  } catch (error) {
    console.error("Error waiting for chart data:", error);
    return false;
  }
};
