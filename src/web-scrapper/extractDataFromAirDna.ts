import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import ejs from "ejs";
import { LISTING_TEMPLATE_PATH, TOP_COMPETITOR_PATH } from "../constants";
import { extractScrapedData, login, waitForImages } from "../helpers/scrapping";

// Function to scrape data from AIR DNA and generate a performance pdf report
export const scrapeAndForwardData = async (address: string, id: number) => {
  const email = process.env.AIRDNA_EMAIL;
  const password = process.env.AIRDNA_PASSWORD;
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await login(page, { email, password });

    await page.waitForSelector(".css-1a9leff", { timeout: 10000 });
    const searchInputSelector =
      'input[placeholder="Search market, submarket, or address"]';
    await page.fill(searchInputSelector, address);

    const dropdownSelector = ".MuiAutocomplete-popper li";
    await page.waitForSelector(dropdownSelector, { timeout: 10000 });

    const listings = await page.$$(dropdownSelector);
    if (listings.length === 0) {
      throw new Error("No listings found for the given address.");
    }

    await page.waitForTimeout(2000);
    await listings[0].click();

    await page.waitForTimeout(8000);

    const scrappedData = await extractScrapedData(page);
    console.log("scrappedData==>>", scrappedData);
    const topCompetitorPath = path.resolve(TOP_COMPETITOR_PATH);
    let isSelectAllAvailable = false;
    const links = await page.$$('a.MuiLink-root[href^="/data/us/airdna-"]');

    // Loop through the links and click the one containing "See All"
    for (let link of links) {
      const linkText = await link.evaluate((el) => el.textContent);
      if (linkText.includes("See All")) {
        isSelectAllAvailable = true;
        await link.click();
        break;
      }
    }
    let topCompSs = "";
    if (isSelectAllAvailable) {
      await page.waitForSelector(
        "div.MuiGrid-root.MuiGrid-container.css-dxp6xd"
      );
      await waitForImages(page);
      await page.screenshot({
        path: topCompetitorPath,
        clip: await page.locator(".MuiBox-root.css-183i0oq").boundingBox(),
      });

      const base64TopComp = await fs.promises.readFile(topCompetitorPath, {
        encoding: "base64",
      });
      topCompSs = `data:image/png;base64,${base64TopComp}`;
    }

    const { propertyAddress, projectedRevenue, propertyOverviewData } =
      scrappedData;

    const templatePath = path.resolve(LISTING_TEMPLATE_PATH);
    const html = await ejs.renderFile(templatePath, {
      title: "Property Performance Report",
      address: propertyAddress,
      executiveSummary:
        "This case highlights the importance of revenue forecasting...",
      marketOverview: [
        {
          beds: propertyOverviewData.bedCount,
          baths: propertyOverviewData.bathCount,
          guests: propertyOverviewData.guestCount,
        },
      ],
      recommendations: ["Lorem1", "Lorem2", "Lorem3"],
      projectedRevenue,
      topCompetitorSrc: topCompSs,
    });

    // Convert the EJS file to PDF
    const pdfPath = path.resolve(`./public/pdf/${id}/output.pdf`);
    const pdfPage = await context.newPage();
    await pdfPage.setContent(html, { waitUntil: "load" });
    await pdfPage.pdf({
      path: pdfPath,
      format: "A4",
    });

    console.log(`PDF generated at: ${pdfPath}`);
    return pdfPath;
  } catch (error) {
    console.error("Error during scraping or forwarding:", error);
    return;
  } finally {
    await browser.close();
  }
};

//   "4912 S Washington Park Ct, Chicago, Illinois"
