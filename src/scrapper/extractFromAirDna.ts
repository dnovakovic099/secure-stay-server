import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import ejs from "ejs";
import { writeFile } from "fs/promises";
import axios from "axios";
// Define types for login credentials and scraped data
type LoginCredentials = {
  email: string;
  password: string;
};

type ScrapedData = {
  imageSrc: string | null;
  propertyName: string | null;
  propertyAddress: string | null;
  market: string | null;
  marketScore: string | null;
  propertyType: string | null;
  bedCount: string | null;
  bathCount: string | null;
  guestCount: string | null;
  downloadPdfButton: any;
};

// Function to scrape data from AIR DNA
const scrapeAndForwardData = async (
  loginCredentials: LoginCredentials,
  address: string
) => {
  const browser = await chromium.launch({ headless: false }); // Set to true for headless mode
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Navigate to the login page
    await page.goto("https://app.airdna.co/data/login");

    // Fill in login credentials and submit
    await page.fill('input[name="email"]', loginCredentials.email);
    await page.fill('input[name="password"]', loginCredentials.password);
    await page.click('button[type="submit"]');

    await page.waitForSelector(".css-1a9leff", { timeout: 10000 });
    const searchInputSelector =
      'input[placeholder="Search market, submarket, or address"]';
    await page.fill(searchInputSelector, address);

    // Wait for the autocomplete dropdown to load
    const dropdownSelector = ".MuiAutocomplete-popper li";
    await page.waitForSelector(dropdownSelector, { timeout: 10000 });

    // Select the first listing (adjust based on desired logic, e.g., specific text match or index)
    const listings = await page.$$(dropdownSelector);
    if (listings.length === 0) {
      throw new Error("No listings found for the given address.");
    }

    await listings[0].click();

    await page.waitForTimeout(10000);

    // Extracting the image source and property details within page.evaluate()
    const scrappedData = await page.evaluate(() => {
      const imageSrcElement = document.querySelector("img.MuiBox-root");
      const propertyNameElement = document.querySelector(
        "h6.MuiTypography-titleXXS"
      );
      const propertyAddressElement = document.querySelector(
        "h6.MuiTypography-root"
      );
      const marketElement = document.querySelector(
        "p.MuiTypography-root.css-1duvi1q"
      );
      const elements = document.querySelectorAll(
        "p.MuiTypography-root.css-wd00qg"
      );

      // Access specific elements by their index
      const marketScoreElement = elements[0]; // First matching element
      const propertyTypeElement = elements[1]; // Second matching element

      // Extract text content
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
        imageSrc: imageSrcElement ? imageSrcElement.getAttribute("src") : null,
        propertyName: propertyNameElement
          ? propertyNameElement.textContent
          : null,
        propertyAddress: propertyAddressElement
          ? propertyAddressElement.textContent
          : null,
        marketData,
        propertyOverviewData,
      };
    });

    console.log("scrappedData==>>", scrappedData);
    const {
      propertyName,
      propertyAddress,
      imageSrc,
      marketData,
      propertyOverviewData,
    } = scrappedData;
    const base64 = await convertBlobToBase64(imageSrc);
    console.log("base64", base64);

    const templatePath = path.resolve("./public/template/listing.ejs");
    const html = await ejs.renderFile(templatePath, {
      title: "Property Revenue Report",
      propertyName,
      address: propertyAddress,
      introduction:
        "This case highlights the importance of revenue forecasting...",
      // marketOverview:
      //   "Revenue trends indicate a 20% increase, suggesting competitive pricing...",
      ...marketData,
      propertyOverviewData,
      propertyImage: base64,
      propertyOverview: "The property is projected to generate $90,300...",
      competitorAnalysis:
        "Competitor analysis shows the property is among the top 3...",
      recommendationsImage: base64,
      recommendations: [
        "Introduce advanced pricing strategies...",
        "Enhance the guest experience...",
        "Target marketing efforts towards extended stays...",
      ],
      conclusion:
        "By partnering with Luxury Lodging, the owner can focus on broader goals...",
    });

    // const outputHtmlPath = path.resolve("output.html");
    // await writeFile(outputHtmlPath, html, "utf-8");

    // Convert the HTML to PDF
    const pdfPath = path.resolve("./public/pdf/output.pdf");
    const pdfPage = await context.newPage();
    await pdfPage.setContent(html, { waitUntil: "load" });
    await pdfPage.pdf({
      path: pdfPath,
      format: "A4",
    });

    console.log(`PDF generated at: ${pdfPath}`);
  } catch (error) {
    console.error("Error during scraping or forwarding:", error);
  } finally {
    await browser.close();
  }
};

scrapeAndForwardData(
  {
    email: "dnovakovic21@gmail.com",
    password: "ZtztQ7K@A53##eeI",
  },
  "4912 S Washington Park Ct, Chicago, Illinois"
);

function blobToBase64(blob: Blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    // Read the blob as a data URL
    reader.readAsDataURL(blob);

    // Resolve the Base64 string when the read is complete
    reader.onloadend = () => {
      let base64String = reader.result as string;
      base64String.split(",")[1]; // Remove "data:<type>;base64,"
      resolve(base64String);
    };

    // Handle errors
    reader.onerror = (error) => {
      reject(error);
    };
  });
}

// Usage example
async function convertBlobToBase64(blobString: string) {
  // Simulate a Blob (replace with your actual blob)
  const blob = new Blob([blobString], { type: "text/plain" });

  try {
    const base64String = await blobToBase64(blob);
    console.log("Base64 String:", base64String);
  } catch (error) {
    console.error("Error:", error);
  }
}
