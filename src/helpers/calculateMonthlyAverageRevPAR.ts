export const calculateMonthlyAverageRevPAR = (revparData) => {
    const monthlyData = {};

    // Group RevPAR data by month
    revparData.forEach(({ date, revpar }) => {
      const month = date.toLocaleString('default', { month: 'long' });
      if (!monthlyData[month]) {
        monthlyData[month] = { totalRevpar: 0, count: 0 };
      }
      monthlyData[month].totalRevpar += revpar;
      monthlyData[month].count += 1;
    });

    // Calculate average RevPAR for each month
    const monthlyAverageRevPAR = Object.entries(monthlyData).map(([month, data]) => {
      const { totalRevpar, count } = data as { totalRevpar: number, count: number };
      return {
        month,
        averageRevpar: totalRevpar / count,
      };
    });

    return monthlyAverageRevPAR;
  };