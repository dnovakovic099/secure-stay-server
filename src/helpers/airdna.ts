import { ElementHandle, Page } from "puppeteer";
import { IListingPageElementData, LoginCredentials } from "../types";
import { AIR_DNA_URL, USER_AGENTS } from "../constants";

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

export const generateRandomUA = () => {
  const randomUAIndex = Math.floor(Math.random() * USER_AGENTS.length);

  return USER_AGENTS[randomUAIndex];
};

// export const scrapeDataFromSelectedAddress = (page: Page) => {
//   return page.evaluate(() => {
//     const propertyAddressElement = document.querySelector(
//       "h6.MuiTypography-titleXXS"
//     );

//     const marketElement = document.querySelector(
//       "p.MuiTypography-root.css-1duvi1q"
//     );
//     const elements = document.querySelectorAll(
//       "p.MuiTypography-root.css-wd00qg"
//     );
//     const marketScoreElement = elements[0];
//     const propertyTypeElement = elements[1];

//     const marketScore = marketScoreElement?.textContent.trim() || "";
//     const propertyType = propertyTypeElement?.textContent.trim() || "";
//     const bedCountElement = document.querySelector(
//       "p.MuiTypography-root.css-1an2wsc"
//     );
//     const bathCountElement = document.querySelector(
//       "p.MuiTypography-root.css-wd00qg"
//     );
//     const guestCountElement = document.querySelector(
//       "p.MuiTypography-root.css-1an2wsc"
//     );

//     const projectedRevenueElements = document.querySelectorAll(
//       "div.MuiBox-root.css-1abrbpw"
//     );
//     console.log(projectedRevenueElements, guestCountElement, bathCountElement);

//     const projectedRevenue = Array.from(projectedRevenueElements).map(
//       (element) => {
//         const valueElement = element.querySelector(
//           "h3.MuiTypography-root.MuiTypography-titleM.css-6xs9nt"
//         );
//         const descriptionElement = element.querySelector(
//           "p.MuiTypography-root.MuiTypography-body2.css-1p8l434"
//         );

//         return {
//           value: valueElement?.textContent.trim() || null,
//           title: descriptionElement?.textContent.trim() || null,
//         };
//       }
//     );

//     const marketData = {
//       market: marketElement ? marketElement.textContent : null,
//       marketScore,
//       marketType: propertyType,
//     };
//     const propertyOverviewData = {
//       bedCount: bedCountElement ? bedCountElement.textContent : null,
//       bathCount: bathCountElement ? bathCountElement.textContent : null,
//       guestCount: guestCountElement ? guestCountElement.textContent : null,
//     };
//     return {
//       propertyAddress: propertyAddressElement
//         ? propertyAddressElement.textContent
//         : null,
//       marketData,
//       propertyOverviewData,
//       projectedRevenue: projectedRevenue.length ? projectedRevenue[0] : [],
//     };
//   });
// };

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
      (response) =>
        response.url() ===
          "https://api.airdna.co/api/explorer/v1/rentalizer/estimate/full" &&
        response.status() === 200
    );

    // Extract the response body data
    const data = await response.json();
    console.log("API Response:", data);
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
