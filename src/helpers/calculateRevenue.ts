import { Page } from "puppeteer";


const applyFilterForBedAndBath = async (page: Page, bedCount: number, bathCount: number) => {
    try {




        const listingsButtonSelector = '.MuiButtonBase-root.MuiButton-root.MuiButton-text.MuiButton-textNeutral.MuiButton-sizeSmall.MuiButton-textSizeSmall.MuiButton-colorNeutral.css-1hga4oy';
        await page.waitForSelector(listingsButtonSelector);
        const listingsButtons = await page.$$(listingsButtonSelector);
        console.log("Listings buttons", listingsButtons);
        const listingsButton = listingsButtons[0];
        console.log("Listings button", listingsButton);
        if (listingsButton) {
            const buttonText = await page.evaluate(button => button.textContent, listingsButton);
            console.log("Button text", buttonText);
            if (buttonText.trim() !== 'Listings') {
                const listingButtonSelectorFallback = '.MuiButtonBase-root.MuiButton-root.MuiButton-text.MuiButton-textNeutral.MuiButton-sizeSmall.MuiButton-textSizeSmall.MuiButton-colorNeutral.css-9j6s48';
                await page.waitForSelector(listingButtonSelectorFallback);
                const listingButtonFallback = await page.$(listingButtonSelectorFallback);
                const buttonTextFallback = await page.evaluate(button => button.textContent, listingButtonFallback);
                console.log("Button text fallback", buttonTextFallback);
                if (listingButtonFallback) {
                    await listingButtonFallback.click();
                }
            } else {
                await listingsButton.click();
            }
        }

        const resetButtonSelector = '.MuiButtonBase-root.MuiButton-root.MuiButton-text.MuiButton-textNeutral.MuiButton-sizeMedium.MuiButton-textSizeMedium.MuiButton-colorNeutral.css-a1mucv';
        await page.waitForSelector(resetButtonSelector);
        const resetButton = await page.$(resetButtonSelector);
        if (resetButton) {
            console.log("Reset button found", resetButton);
            await resetButton.click();
        }

        const dropdowns = await page.$$('.MuiSelect-select.MuiSelect-outlined.MuiInputBase-input.MuiOutlinedInput-input.MuiInputBase-inputAdornedStart.css-1c3vwjf');
        if (dropdowns.length > 2) {
            await dropdowns[2].focus();
            await page.keyboard.press("Enter");
            await page.waitForSelector("ul[role='listbox']");
            const option2 = await page.$(`li[data-value='${bedCount}']`);
            if (option2) {
                await option2.click();  // Actually click the option!
                console.log("Option '2' selected for 3rd dropdown");
            }
            // Wait for dropdown to close
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // 4. Handle 4th dropdown (index 3)
        if (dropdowns.length > 3) {
            await dropdowns[3].focus();
            await page.keyboard.press("Enter");
            await page.waitForSelector("ul[role='listbox']");
            const option3 = await page.$(`li[data-value='${bedCount}']`);
            if (option3) {
                await option3.click();
                console.log("Option '3' selected for 4th dropdown");
            }
            // Wait for dropdown to close
            await new Promise(resolve => setTimeout(resolve, 1000));
        }


        if (dropdowns.length > 4) {
            await dropdowns[4].focus();
            await page.keyboard.press("Enter");
            await page.waitForSelector("ul[role='listbox']");
            const option4 = await page.$(`li[data-value='${bathCount}']`);
            if (option4) {
                await option4.click();
                console.log("Option '4' selected for 5th dropdown");
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }


        if (dropdowns.length > 5) {
            await dropdowns[5].focus();
            await page.keyboard.press("Enter");
            await page.waitForSelector("ul[role='listbox']");
            const option5 = await page.$(`li[data-value='${bathCount}']`);
            if (option5) {
                await option5.click();
                console.log("Option '5' selected for 6th dropdown");
            }
            await new Promise(resolve => setTimeout(resolve, 1000));

        }


        const applyButtonSelector = 'button.MuiButtonBase-root.MuiButton-root.MuiButton-contained.MuiButton-containedNeutral.MuiButton-sizeMedium.MuiButton-containedSizeMedium.MuiButton-colorNeutral[type="submit"]';
        await page.waitForSelector(applyButtonSelector);
        const applyButton = await page.$(applyButtonSelector);
        await applyButton.click();
        return true;
    } catch (error) {
        console.log("Error applying filter for bed and bath", error);
        return false;
    }





}

export const calculateRevenue = async (page: Page, address: string, bedCount: number, bathCount: number): Promise<string> => {

    try {



        console.log("This calulcating revenue for address", address, bedCount, bathCount);
        //click submarkPet
        const submarketSelector = ".MuiButtonBase-root.MuiButton-root.MuiButton-text.MuiButton-textNeutral.MuiButton-sizeMedium.MuiButton-textSizeMedium.MuiButton-colorNeutral.MuiButton-root.MuiButton-text.MuiButton-textNeutral.MuiButton-sizeMedium.MuiButton-textSizeMedium.MuiButton-colorNeutral.css-tfn4x1";
        await page.waitForSelector(submarketSelector);
        const submarketButton = await page.$(submarketSelector);
        if (submarketButton) {
            console.log("Submarket button found", submarketButton);
            await submarketButton.click();
        }
        await new Promise(resolve => setTimeout(resolve, 10000));
        const isAppliedFilterForBedAndBath = await applyFilterForBedAndBath(page, bedCount, bathCount);
        if (!isAppliedFilterForBedAndBath) {
            return '0';
        }
        await new Promise(resolve => setTimeout(resolve, 10000));

        const revenueSelector = ".MuiTypography-root.MuiTypography-body1.css-fto4yh";
        await page.waitForSelector(revenueSelector);
        const revenueElements = await page.$$(revenueSelector);

        if (revenueElements.length > 0) {
            const revenueText = await page.evaluate(el => el.textContent, revenueElements[0]);
            return revenueText;
        } else {
            console.log("No revenue elements found.");
        }



        return '0';
    } catch (error) {
        console.log("Error calculating revenue", error);
        return '0';
    }
};



