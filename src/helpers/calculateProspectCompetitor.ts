export function calculateProspectCompetitor(marketAvg: number[], competitorTotal: number): {
    g1: string;
    f1: string;
    competitor: number[];
    prospect: number[];
    competitorSum: number;
    prospectSum: number;
} {
    let g1 = competitorTotal / marketAvg.reduce((sum, val) => sum + val, 0); // Finding G1
    let competitor = marketAvg.map(val => Math.round(val * g1));
    let competitorSum = competitor.reduce((sum, val) => sum + val, 0);
    
    let f1 = g1 * (1 + (Math.random() * 0.04 - 0.02)); // 2% more or less than G1
    let prospect = marketAvg.map(val => Math.round(val * f1));
    let prospectSum = prospect.reduce((sum, val) => sum + val, 0);
    
    return {
        g1: g1.toFixed(4),
        f1: f1.toFixed(4),
        competitor,
        prospect,
        competitorSum,
        prospectSum
    };
}
