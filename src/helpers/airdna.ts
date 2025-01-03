import { Page } from "puppeteer";
import { IListingPageElementData, LoginCredentials } from "../types";
import { AIR_DNA_URL } from "../constants";

export const login = async (page: Page, credentials: LoginCredentials) => {
  try {
    await page.goto(AIR_DNA_URL);
    await page.type('input[name="email"]', credentials.email);
    await page.type('input[name="password"]', credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForSelector(".css-1a9leff", { timeout: 10000 });
    return true;
  } catch (error) {
    console.error("Login failed:", error);
    throw new Error("Unable to log in to AirDNA");
  }
};

export const scrapeDataFromSelectedAddress = (page: Page) => {
  return page.evaluate(() => {
    const propertyAddressElement = document.querySelector(
      "h6.MuiTypography-titleXXS"
    );

    const marketElement = document.querySelector(
      "p.MuiTypography-root.css-1duvi1q"
    );
    const elements = document.querySelectorAll(
      "p.MuiTypography-root.css-wd00qg"
    );
    const marketScoreElement = elements[0];
    const propertyTypeElement = elements[1];

    const marketScore = marketScoreElement?.textContent.trim() || "";
    const propertyType = propertyTypeElement?.textContent.trim() || "";
    const bedCountElement = document.querySelector(
      "p.MuiTypography-root.css-1an2wsc"
    );
    const bathCountElement = document.querySelector(
      "p.MuiTypography-root.css-wd00qg"
    );
    const guestCountElement = document.querySelector(
      "p.MuiTypography-root.css-1an2wsc"
    );

    const projectedRevenueElements = document.querySelectorAll(
      "div.MuiBox-root.css-1abrbpw"
    );
    console.log(projectedRevenueElements, guestCountElement, bathCountElement);

    const projectedRevenue = Array.from(projectedRevenueElements).map(
      (element) => {
        const valueElement = element.querySelector(
          "h3.MuiTypography-root.MuiTypography-titleM.css-6xs9nt"
        );
        const descriptionElement = element.querySelector(
          "p.MuiTypography-root.MuiTypography-body2.css-1p8l434"
        );

        return {
          value: valueElement?.textContent.trim() || null,
          title: descriptionElement?.textContent.trim() || null,
        };
      }
    );

    const marketData = {
      market: marketElement ? marketElement.textContent : null,
      marketScore,
      marketType: propertyType,
    };
    const propertyOverviewData = {
      bedCount: bedCountElement ? bedCountElement.textContent : null,
      bathCount: bathCountElement ? bathCountElement.textContent : null,
      guestCount: guestCountElement ? guestCountElement.textContent : null,
    };
    return {
      propertyAddress: propertyAddressElement
        ? propertyAddressElement.textContent
        : null,
      marketData,
      propertyOverviewData,
      projectedRevenue: projectedRevenue.length ? projectedRevenue[0] : [],
    };
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
