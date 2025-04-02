import { Page } from "puppeteer";


const applyFilterForBedAndBath = async (page: Page, bedCount: number, bathCount: number) => {
    const applyFilterForBedAndBathSelector = ".MuiButtonBase-root.MuiButton-root.MuiButton-text.MuiButton-textNeutral.MuiButton-sizeMedium.MuiButton-textSizeMedium.MuiButton-colorNeutral.MuiButton-root.MuiButton-text.MuiButton-textNeutral.MuiButton-sizeMedium.MuiButton-textSizeMedium.MuiButton-colorNeutral.css-tfn4x1";
    await page.$$(applyFilterForBedAndBathSelector)[0].click();
    await new Promise(resolve => setTimeout(resolve, 10000));
}

export const calculateRevenue = async (page: Page, address: string, bedCount: number, bathCount: number) => {

  
    

    //click submarket
    const submarketSelector = ".MuiButtonBase-root.MuiButton-root.MuiButton-text.MuiButton-textNeutral.MuiButton-sizeMedium.MuiButton-textSizeMedium.MuiButton-colorNeutral.MuiButton-root.MuiButton-text.MuiButton-textNeutral.MuiButton-sizeMedium.MuiButton-textSizeMedium.MuiButton-colorNeutral.css-tfn4x1";
    await page.$$(submarketSelector)[0].click();
    await new Promise(resolve => setTimeout(resolve, 10000));

    const isAppliedFilterForBedAndBath = await applyFilterForBedAndBath(page, bedCount, bathCount);
    
    

  
  return 0;
};



