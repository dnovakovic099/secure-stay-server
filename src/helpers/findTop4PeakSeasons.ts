export const findTop4PeakSeasons = (monthlyAverageRevPAR) => {
    // Sort the monthly averages by RevPAR in descending order
    const sortedMonthlyData = monthlyAverageRevPAR.sort((a, b) => b.averageRevpar - a.averageRevpar);

    // Extract the top 4 peak seasons
    return sortedMonthlyData.slice(0, 4).map(item => item.month);
  };