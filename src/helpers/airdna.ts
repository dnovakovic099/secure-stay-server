import { ElementHandle, Page } from "puppeteer";
import { IListingPageElementData, LoginCredentials } from "../types";
import { AIR_DNA_URL, USER_AGENTS } from "../constants";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import sharp from 'sharp';

export const login = async (page: Page, credentials: LoginCredentials) => {
  try {
    await page.goto(AIR_DNA_URL);
    const emailBtn = await page.$('.email-btn');
    if (!emailBtn) {
      await page.waitForSelector('#loginId');
      await page.waitForSelector('#password');
      await page.waitForSelector('#submit-button');

      await page.type('#loginId', credentials.email);
      await page.type('#password', credentials.password);
      await page.click('#submit-button');
    } else {

      const isEmailBtnActive = await page.evaluate((btn) => {
        return btn.classList.contains('email-btn-active');
      }, emailBtn);
      if (!isEmailBtnActive) {
        await emailBtn.click();
        await page.type('#loginId', credentials.email);
        await page.type('#password', credentials.password);
        await page.click('#submit-button');
      }


    }



    // await page.waitForNetworkIdle();



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
      ".MuiInputBase-root.MuiOutlinedInput-root.MuiInputBase-colorPrimary.css-o7n5w9:nth-of-type(1)"
    );
    await selectValueFromDropdown(
      baths,
      ".MuiInputBase-root.MuiOutlinedInput-root.MuiInputBase-colorPrimary.css-o7n5w9:nth-of-type(2)"
    );
    await selectValueFromDropdown(
      guests,
      ".MuiInputBase-root.MuiOutlinedInput-root.MuiInputBase-colorPrimary.css-o7n5w9:nth-of-type(3)"
    );

    const updateButtonSelector = ".css-1s2qgu0";
    await page.waitForSelector(updateButtonSelector, { visible: true });
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
  page: Page,
  clip = false,
): Promise<string | null> => {
  try {

    if (element) {
      if (imageName === 'propertyStatisticsGraph') {
        // wait utill all svgs or the line graph got finshed being drawn
        await page.waitForFunction(() => {
          const svgs = document.querySelectorAll('.MuiBox-root.css-1czpbid svg');
          return svgs.length > 0
        }, { timeout: 10000 });
      }

      await page.evaluate(() => {
        document.body.style.zoom = "100%";
      })

      if (imageName === 'nearbyPropertyListings') {
        // // Set zoom to 85%
        await page.evaluate(() => {
          document.body.style.zoom = "85%";
        });

        // Wait for network requests to finish
        // await page.waitForNetworkIdle();
        delay(15000);
      }

      // Take screenshot with improved options and clip
      const screenshotBuffer = await element.screenshot({
        encoding: "binary",
        type: 'png',
        ...(imageName === 'occupancySection1' ? {
          clip: {
            x: 50,
            y: 0,
            width: (await element.boundingBox()).width - 100,
            height: (await element.boundingBox()).height - 0
          }
        } : clip ? {
          clip: {
            x: 0,
            y: 50,
            width: (await element.boundingBox()).width,
            height: (await element.boundingBox()).height - 50
          }
        } : {})
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
    const listingsButtonSelector = '.MuiButtonBase-root.MuiButton-root.MuiButton-text.MuiButton-textNeutral.MuiButton-sizeSmall.MuiButton-textSizeSmall.MuiButton-colorNeutral.css-9j6s48';
    await page.waitForSelector(listingsButtonSelector);
    const listingsButton = await page.$(listingsButtonSelector);
    const buttonText = await page.evaluate(button => button.textContent, listingsButton);
    if(buttonText.trim() !== 'Listings'){
     return true; 
    }

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

export const takeScreenShots = async (page: Page, beds: string)  => {
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
    chartContainer: ".MuiBox-root.css-1vx1dtt",
    tabs: ".MuiButtonBase-root.MuiTab-root.MuiTab-textColorPrimary.css-1gul72i",
    divs:'.MuiBox-root.css-79elbk',
    downloadButton:'.MuiButtonBase-root.MuiButton-root.MuiButton-text.MuiButton-textInherit.MuiButton-sizeSmall.MuiButton-textSizeSmall.MuiButton-colorInherit.css-fmxw1l',
    occupancyInsight:'.MuiBackdrop-root.css-ouksm'
    // occupanyChart: ".MuiBox-root.css-68ddzu",
  };

  // Helper to click a link and wait for navigation or idle state
  const clickAndWait = async (selector: string) => {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      const link = await page.$(selector);
      if (link) {
        await link.click();
        // await page.waitForNetworkIdle();
        delay(10000);
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
    nearbyPropertyLisingSS: null,
    occupancySection: null,
    
  };

  try {
    // Step 2: Navigate to Market Type Section and Capture Screenshot
    await clickAndWait(selectors.marketTypeLink);

    // await page.waitForNetworkIdle();
    delay(20000);

    await applyFilterViaListing(page, beds);

    // Wait for network idle first
    // await page.waitForNetworkIdle();
    await new Promise(resolve => setTimeout(resolve, 20000));


    await page.waitForSelector(selectors.propertyStatisticsGraph);
    const propertyStatSelc = await page.$(selectors.propertyStatisticsGraph);
    screenShots.propertyStatisticsGraphSS = await takeScreenshot(
      propertyStatSelc,
      "propertyStatisticsGraph",
      sessionDir,
      false,
      page
    );


    await page.waitForSelector(selectors.chartContainer);
    const chartElements = await page.$$(selectors.chartContainer);

    if (chartElements.length === 44) {
      const tabs = await page.$$(selectors.tabs);

      // Occupancy chart
      await tabs[5].click();
      await delay(10000);


      const divs = await page.$$('.MuiBox-root.css-79elbk');
      if (divs.length > 0) {
        divs.forEach(async (div, index) => {
          const divText = await page.evaluate(el => el.textContent, div);
          console.log(`Div ${index}: ${divText}`);
        });
      }

      // Take screenshots of divs at index 6 and 7 using Sharp cropping
      if (divs.length > 7) {
        // For div at index 6
        const div6Dimensions = await page.evaluate((index) => {
          const element = document.querySelectorAll(selectors.divs)[index];
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          };
        }, 6);

        if (div6Dimensions) {
          const screenshotBuffer = await page.screenshot({
            encoding: 'binary',
            type: 'png',
          });

          const croppedBuffer = await sharp(screenshotBuffer)
            .extract({
              left: Math.max(0, Math.floor(div6Dimensions.x)),
              top: Math.max(0, Math.floor(div6Dimensions.y)),
              width: Math.floor(div6Dimensions.width),
              height: Math.floor(div6Dimensions.height)
            })
            .toBuffer();

          const occupancySection2Path = path.join(sessionDir, 'occupancySection2.png');
          await fs.promises.writeFile(occupancySection2Path, croppedBuffer);
        }

        await delay(6000);

        // For div at index 7
        const div7Dimensions = await page.evaluate((index) => {
          const element = document.querySelectorAll(selectors.divs)[index];
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          };
        }, 7);

        if (div7Dimensions) {
          const screenshotBuffer = await page.screenshot({
            encoding: 'binary',
            type: 'png',
          });

          const croppedBuffer = await sharp(screenshotBuffer)
            .extract({
              left: Math.max(0, Math.floor(div7Dimensions.x)),
              top: Math.max(0, Math.floor(div7Dimensions.y)),
              width: Math.floor(div7Dimensions.width),
              height: Math.floor(div7Dimensions.height)
            })
            .toBuffer();

          const occupancySection3Path = path.join(sessionDir, 'occupancySection3.png');
          await fs.promises.writeFile(occupancySection3Path, croppedBuffer);
        }
      }

      await delay(10000);


      await waitForChartData(page, chartElements[16]);
      
      // Get dimensions of the chart element
      const chartDimensions = await page.evaluate((element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        };
      }, chartElements[16]);

      if (chartDimensions) {
        const screenshotBuffer = await page.screenshot({
          encoding: 'binary',
          type: 'png',
        });

        const croppedBuffer = await sharp(screenshotBuffer)
          .extract({
            left: Math.max(0, Math.floor(chartDimensions.x)),
            top: Math.max(0, Math.floor(chartDimensions.y + 50)), // Deduct 50px from top
            width: Math.floor(chartDimensions.width),
            height: Math.floor(chartDimensions.height - 50) // Adjust height to maintain bottom position
          })
          .toBuffer();

        const averageMonthlyOccupancyChartPath = path.join(sessionDir, 'averageMonthlyOccupancyChart.png');
        await fs.promises.writeFile(averageMonthlyOccupancyChartPath, croppedBuffer);
        screenShots.averageMonthlyOccupancyChartSS = averageMonthlyOccupancyChartPath;
      }

      // Revenue chart
      await tabs[6].click();
      await delay(3000);





      await waitForChartData(page, chartElements[25]);
      // Find the download button within chartElements[25]
      const downloadButton = await page.$$(selectors.downloadButton);
      console.log("downloadButton", downloadButton);
      if (!downloadButton) {
        throw new Error('Download button not found');
      }

      try {
        // Set up download behavior using proper API
        const client = await page.createCDPSession();
        await client.send('Page.setDownloadBehavior', {
          behavior: 'allow',
          downloadPath: sessionDir
        });

        // Set up download event listener
        let downloadResolved = false;
        const downloadPromise = new Promise<{ url: string } | null>((resolve) => {
          client.on('Page.downloadWillBegin', (event: { url: string }) => {
            console.log('Download started:', event);
            downloadResolved = true;
            resolve(event);
          });
        });

        // Click the download button
        console.log('Clicking download button...');
        await downloadButton[5].click();
        await delay(10000);

        await tabs[8].click();
        await delay(3000);


        await downloadButton[15].click();

        // Close the CDP session
        await client.detach();
      } catch (error) {
        console.error("Error during download:", error);
      }

      // Scroll down 400px
      await page.evaluate(() => {
        window.scrollBy(0, 400);
      });

      // Wait for the element to be available
      await page.waitForSelector(selectors.occupancyInsight);

      // Select the element at the 15th index
      const elements = await page.$$(selectors.occupancyInsight);
      if (elements.length > 15) {
        const targetElement = elements[15];

        // Take screenshot of the selected element
        const occupancySection1 = await takeScreenshot(
          targetElement,
          'occupancySection1',
          sessionDir,
          true,
          page,
        )

        console.log('Screenshot taken: occupancySection1.png');
      } else {
        console.error('Element at the 15th index not found.');
      }

      // Continue with the rest of the code
      console.log('Continuing with rest of the code...');
      await tabs[6].click();
      await delay(6000);

       const revenueChartDimensions = await page.evaluate((element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        };
      }, chartElements[25]);

      if (revenueChartDimensions) {
        const screenshotBuffer = await page.screenshot({
          encoding: 'binary',
          type: 'png',
        });

        const croppedBuffer = await sharp(screenshotBuffer)
          .extract({
            left: Math.max(0, Math.floor(revenueChartDimensions.x)),
            top: Math.max(0, Math.floor(revenueChartDimensions.y + 50)), // Deduct 50px from top
            width: Math.floor(revenueChartDimensions.width),
            height: Math.floor(revenueChartDimensions.height - 50) // Adjust height to maintain bottom position
          })
          .toBuffer();

        const revenueGraphPath = path.join(sessionDir, 'revenueGraph.png');
        await fs.promises.writeFile(revenueGraphPath, croppedBuffer);
        screenShots.revenueGraphSS = revenueGraphPath;
      }
    }

    // Step 3: Navigate to All Listings Section and Capture Screenshot
    


    const elements = await page.$$(selectors.allListingLink);
    if (elements.length > 0) {
      await elements[2].click();
      // await page.waitForNetworkIdle();
      await new Promise(resolve => setTimeout(resolve, 20000));
    } else {
      throw new Error(`No element found at index 3 for nearbyPropertyListings`);
    }





    await page.waitForSelector(selectors.nearbyPropertyListings);
    const nearbyPropertySelec = await page.$(selectors.nearbyPropertyListings);



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

  // count the number files we add to the sessionDir
  const files = await fs.promises.readdir(sessionDir);
  if(files.length !== 9) {
    // delete the sessionDir
    await fs.promises.rmdir(sessionDir, { recursive: true }); 
    return { screenshotSessionId: sessionId, screenShots, error: "There are missing files in the sessionDir please try again" };
  }

  return { screenshotSessionId: sessionId, screenShots, error: null };
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
    console.log("data", JSON.stringify(data));
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
    marketSection: ".MuiBox-root.css-186n0wg",
    links: ".MuiTypography-root.MuiTypography-inherit.MuiLink-root.MuiLink-underlineAlways.css-14nb2a7"
  };

  let airBnbLink = null;
  const links = await page.$$(selectors.links);
  if (links.length > 1) {
    const secondLink = links[0];
    const isAnchor = await page.evaluate(element => {
      return element.tagName.toLowerCase() === 'a';
    }, secondLink);

    if (isAnchor) {
      const href = await page.evaluate((element: any) => element.href, secondLink);
      airBnbLink = href;
    }
  }

  try {
    await fs.promises.mkdir(sessionDir, { recursive: true });

    // Write Airbnb link to txt file if it exists
    if (airBnbLink) {
      const txtPath = path.join(sessionDir, 'airbnb-link.txt');
      await fs.promises.writeFile(txtPath, airBnbLink);
    }

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
          // Special handling for imgSection using Sharp
          if (key === 'imgSection') {
            // Get dimensions of the imgSection element
            const imgSectionDimensions = await page.evaluate((sel) => {
              const element = document.querySelector(sel);
              if (!element) return null;
              const rect = element.getBoundingClientRect();
              return {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
              };
            }, selector);

            if (imgSectionDimensions) {
              // Take full page screenshot
              const screenshotBuffer = await page.screenshot({
                encoding: 'binary',
                type: 'png',
              });

              // Use sharp to crop the image
              const croppedBuffer = await sharp(screenshotBuffer)
                .extract({
                  left: Math.max(0, Math.floor(imgSectionDimensions.x)),
                  top: Math.max(0, Math.floor(imgSectionDimensions.y)),
                  width: Math.floor(imgSectionDimensions.width),
                  height: Math.floor(imgSectionDimensions.height)
                })
                .toBuffer();

              // Save the cropped image
              const imgSectionPath = path.join(sessionDir, `${key}.png`);
              await fs.promises.writeFile(imgSectionPath, croppedBuffer);
            }
          } else {
            // Normal screenshot for other sections
            await takeScreenshot(element, key, sessionDir, false, page);
          }
        } else {
          console.warn(`Element for ${key} not found.`);
        }
       
      } catch (error) {
        console.warn(`Error processing ${key}:`, error);
      }
    }

     // count the number files we add to the sessionDir
     const files = await fs.promises.readdir(sessionDir);
     if(files.length !== 6) {
      // delete the sessionDir
      await fs.promises.rmdir(sessionDir, { recursive: true });
       return { screenshotSessionId: sessionId, error: "There are missing files in the sessionDir please try again" };
     }

    return { screenshotSessionId: sessionId, error: null };
  } catch (error) {
    console.error("Error taking screenshots:", error);
    return { screenshotSessionId: sessionId, error: "There was an error taking screenshots" };
  }
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
    marketSection: ".MuiBox-root.css-186n0wg",
    links: ".MuiTypography-root.MuiTypography-inherit.MuiLink-root.MuiLink-underlineAlways.css-14nb2a7",
    revenueSelector:'.MuiTypography-root.MuiTypography-titleXL.css-gpfoz5',
    competitorNameSelector:'.MuiTypography-root.MuiTypography-titleXXS.MuiTypography-noWrap.css-1gnb1w2'
  };

  let airBnbLink = null;
  const links = await page.$$(selectors.links);
  if (links.length > 1) {
    const secondLink = links[0];
    const isAnchor = await page.evaluate(element => {
      return element.tagName.toLowerCase() === 'a';
    }, secondLink);

    if (isAnchor) {
      const href = await page.evaluate((element: any) => element.href, secondLink);
      airBnbLink = href;
    }
  }

  let revenuePotential = null;
  await page.waitForSelector(selectors.revenueSelector);
  const revenueElement = await page.$(selectors.revenueSelector);
  if (revenueElement) {
    const revenueText = await page.evaluate(element => element.textContent, revenueElement);
    const revenueNumber = revenueText.replace(/[^0-9.]/g, ''); // Remove currency symbol and 'K'
    revenuePotential = revenueNumber;
  }

  let competitorName = null;
  await page.waitForSelector(selectors.competitorNameSelector);
  const competitorNameElement = await page.$(selectors.competitorNameSelector);
  if (competitorNameElement) {
    competitorName = await page.evaluate(element => element.textContent, competitorNameElement);
  }

  try {
    await fs.promises.mkdir(sessionDir, { recursive: true });

    // Write Airbnb link to txt file if it exists
    if (airBnbLink) {
      const txtPath = path.join(sessionDir, 'airbnb-link.txt');
      await fs.promises.writeFile(txtPath, airBnbLink);
    }

    if (revenuePotential) {
      const revenueFilePath = path.join(sessionDir, 'competitor-revenue-potential.txt');
      await fs.promises.writeFile(revenueFilePath, revenuePotential);
    }

    if (competitorName) {
      const competitorNameFilePath = path.join(sessionDir, 'competitor-name.txt');
      await fs.promises.writeFile(competitorNameFilePath, competitorName);
    }

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
          // Special handling for imgSection using Sharp
          if (key === 'imgSection') {
            // Get dimensions of the imgSection element
            const imgSectionDimensions = await page.evaluate((sel) => {
              const element = document.querySelector(sel);
              if (!element) return null;
              const rect = element.getBoundingClientRect();
              return {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
              };
            }, selector);

            if (imgSectionDimensions) {
              // Take full page screenshot
              const screenshotBuffer = await page.screenshot({
                encoding: 'binary',
                type: 'png',
              });

              // Use sharp to crop the image
              const croppedBuffer = await sharp(screenshotBuffer)
                .extract({
                  left: Math.max(0, Math.floor(imgSectionDimensions.x)),
                  top: Math.max(0, Math.floor(imgSectionDimensions.y)),
                  width: Math.floor(imgSectionDimensions.width),
                  height: Math.floor(imgSectionDimensions.height)
                })
                .toBuffer();

              // Save the cropped image
              const imgSectionPath = path.join(sessionDir, `${key}.png`);
              await fs.promises.writeFile(imgSectionPath, croppedBuffer);
            }
          } else {
            // Normal screenshot for other sections
            await takeScreenshot(element, key, sessionDir, false, page);
          }
        } else {
          console.warn(`Element for ${key} not found.`);
        }
      } catch (error) {
        console.warn(`Error processing ${key}:`, error);
      }
    }

    // count the number files we add to the sessionDir
    const files = await fs.promises.readdir(sessionDir);
    if(files.length !== 8) {
      // delete the sessionDir
      await fs.promises.rmdir(sessionDir, { recursive: true });
      return { screenshotSessionId: sessionId, error: "There are missing files in the sessionDir please try again" };
    }

    return { screenshotSessionId: sessionId, error: null };
  } catch (error) {
    console.error("Error taking screenshots:", error);
    return { screenshotSessionId: sessionId, error: "There was an error taking screenshots" };
  }

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
