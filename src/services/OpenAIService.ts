import OpenAI from "openai";
import { appDatabase } from "../utils/database.util";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { PropertyInfo } from "../entity/PropertyInfo";
import { PropertyBedTypes } from "../entity/PropertyBedTypes";
import { PropertyBathroomLocation } from "../entity/PropertyBathroomLocation";
import { PropertyParkingInfo } from "../entity/PropertyParkingInfo";
import logger from "../utils/logger.utils";
import * as fs from "fs";
import * as path from "path";

// Types for generated listing descriptions
export interface GeneratedListingDescriptions {
    titles: string[];
    summary: string;
    theSpace: string;
    theNeighborhood: string;
    houseRules: string;
    guestAccess: string;
    otherThingsToNote: string;
    interactionWithGuests: string;
}

export interface PropertyDataForGeneration {
    // Basic property info
    propertyType: string | null;
    externalListingName: string | null;
    internalListingName: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    country: string | null;

    // Capacity
    personCapacity: number | null;
    bedroomsNumber: number | null;
    bathroomsNumber: number | null;
    guestBathroomsNumber: number | null;

    // Bed types
    bedTypes: Array<{
        bedroomName: string;
        bedType: string;
        quantity: number;
    }>;

    // Bathroom locations
    bathroomLocations: Array<{
        bathroomName: string;
        bathroomType: string;
        features: string[];
    }>;

    // Amenities
    amenities: string[];

    // House rules
    allowPets: boolean | null;
    petFee: number | null;
    numberOfPetsAllowed: number | null;
    petRestrictionsNotes: string | null;
    allowSmoking: boolean | null;
    allowPartiesAndEvents: boolean | null;
    otherHouseRules: string | null;
    allowChildreAndInfants: boolean | null;

    // Parking
    parkingInfo: Array<{
        parkingType: string;
        numberOfSpots: number;
        isFree: boolean;
    }>;
    parkingInstructions: string | null;

    // Check-in/out
    checkInTimeStart: number | null;
    checkInTimeEnd: number | null;
    checkOutTime: number | null;
    checkInProcess: string[];
    doorLockType: string[];

    // Wifi
    wifiAvailable: string | null;
    wifiSpeed: string | null;

    // Pool/Hot tub
    swimmingPoolNotes: string | null;
    hotTubInstructions: string | null;

    // Climate
    hasAC: boolean;
    hasHeating: boolean;

    // Other
    squareFeet: number | null;
    squareMeters: number | null;
}

export class OpenAIService {
    private openai: OpenAI;
    private ruleSetContent: string;

    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error("OPENAI_API_KEY is not set in environment variables");
        }
        this.openai = new OpenAI({ apiKey });
        this.ruleSetContent = this.loadRuleSet();
    }

    private loadRuleSet(): string {
        try {
            const ruleSetPath = path.join(__dirname, "../docs/openai_listing_description_ruleset.md");
            // Check dist path first (production), then src path (development)
            if (fs.existsSync(ruleSetPath)) {
                return fs.readFileSync(ruleSetPath, "utf-8");
            }
            // Fallback for development - look in secure-stay-server/docs
            const devRuleSetPath = path.join(__dirname, "../../docs/openai_listing_description_ruleset.md");
            if (fs.existsSync(devRuleSetPath)) {
                return fs.readFileSync(devRuleSetPath, "utf-8");
            }
            logger.warn("Rule set file not found, using default rules");
            return "";
        } catch (error) {
            logger.error("Error loading rule set:", error);
            return "";
        }
    }

    /**
     * Get property data for AI generation
     */
    async getPropertyDataForGeneration(propertyId: string): Promise<PropertyDataForGeneration | null> {
        const propertyRepo = appDatabase.getRepository(ClientPropertyEntity);

        const property = await propertyRepo.findOne({
            where: { id: propertyId },
            relations: [
                "propertyInfo",
                "propertyInfo.propertyBedTypes",
                "propertyInfo.propertyBathroomLocation",
                "propertyInfo.propertyParkingInfo"
            ]
        });

        if (!property || !property.propertyInfo) {
            return null;
        }

        const info = property.propertyInfo;
        const amenities = info.amenities || [];

        return {
            propertyType: info.propertyType,
            externalListingName: info.externalListingName,
            internalListingName: info.internalListingName,
            address: property.address,
            city: property.city,
            state: property.state,
            country: property.country,

            personCapacity: info.personCapacity,
            bedroomsNumber: info.bedroomsNumber,
            bathroomsNumber: info.bathroomsNumber,
            guestBathroomsNumber: info.guestBathroomsNumber,

            bedTypes: (info.propertyBedTypes || []).map((bt: PropertyBedTypes) => ({
                bedroomName: bt.bedroomNumber ? `Bedroom ${bt.bedroomNumber}` : "Bedroom",
                bedType: bt.bedTypeId || "Unknown",
                quantity: bt.quantity || 1
            })),

            bathroomLocations: (info.propertyBathroomLocation || []).map((bl: PropertyBathroomLocation) => ({
                bathroomName: bl.bathroomNumber ? `Bathroom ${bl.bathroomNumber}` : "Bathroom",
                bathroomType: bl.bathroomType || "Full",
                features: bl.bathroomFeatures ? bl.bathroomFeatures.split(",") : []
            })),

            amenities,

            allowPets: info.allowPets,
            petFee: info.petFee ? Number(info.petFee) : null,
            numberOfPetsAllowed: info.numberOfPetsAllowed,
            petRestrictionsNotes: info.petRestrictionsNotes,
            allowSmoking: info.allowSmoking,
            allowPartiesAndEvents: info.allowPartiesAndEvents,
            otherHouseRules: info.otherHouseRules,
            allowChildreAndInfants: info.allowChildreAndInfants,

            parkingInfo: (info.propertyParkingInfo || []).map((pi: PropertyParkingInfo) => ({
                parkingType: pi.parkingType || "Driveway",
                numberOfSpots: pi.numberOfParkingSpots || 1,
                isFree: !pi.parkingFee || Number(pi.parkingFee) === 0
            })),
            parkingInstructions: info.parkingInstructions,

            checkInTimeStart: info.checkInTimeStart,
            checkInTimeEnd: info.checkInTimeEnd,
            checkOutTime: info.checkOutTime,
            checkInProcess: info.checkInProcess || [],
            doorLockType: info.doorLockType || [],

            wifiAvailable: info.wifiAvailable,
            wifiSpeed: info.wifiSpeed,

            swimmingPoolNotes: info.swimmingPoolNotes,
            hotTubInstructions: info.hotTubInstructions,

            hasAC: amenities.some((a: string) => a.toLowerCase().includes("air conditioning") || a.toLowerCase().includes("ac")),
            hasHeating: amenities.some((a: string) => a.toLowerCase().includes("heating") || a.toLowerCase().includes("heater")),

            squareFeet: info.squareFeet,
            squareMeters: info.squareMeters
        };
    }

    /**
     * Generate listing descriptions using OpenAI
     */
    async generateListingDescriptions(propertyId: string, additionalNotes?: string): Promise<GeneratedListingDescriptions> {
        const propertyData = await this.getPropertyDataForGeneration(propertyId);

        if (!propertyData) {
            throw new Error(`Property with ID ${propertyId} not found or has no property info`);
        }

        const systemPrompt = this.buildSystemPrompt();
        const userPrompt = this.buildUserPrompt(propertyData, additionalNotes);

        logger.info(`Generating listing descriptions for property ${propertyId}`);

        const response = await this.openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.7,
            response_format: { type: "json_object" }
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new Error("No response from OpenAI");
        }

        try {
            const parsed = JSON.parse(content) as GeneratedListingDescriptions;
            logger.info(`Successfully generated listing descriptions for property ${propertyId}`);
            return parsed;
        } catch (error) {
            logger.error("Error parsing OpenAI response:", error);
            throw new Error("Failed to parse OpenAI response");
        }
    }

    private buildSystemPrompt(): string {
        return `You are a professional vacation rental listing copywriter for Luxury Lodging. Your job is to generate compelling, accurate, and well-formatted listing descriptions based on property data.

${this.ruleSetContent}

IMPORTANT RULES:
1. Only use information provided in the property data - never assume or fabricate features
2. Follow the formatting rules exactly (no em dashes, use ▪️ for bullets, ✔️ for checkmarks)
3. Keep the title under 50 characters
4. Keep the summary under 500 characters
5. If information is missing, omit that section or bullet point
6. Generate 3-5 title options

You must respond in valid JSON format with this structure:
{
    "titles": ["Title Option 1", "Title Option 2", "Title Option 3"],
    "summary": "The listing summary (max 500 chars)",
    "theSpace": "Full The Space section with Highlights, Bedrooms, Bathrooms, Kitchen, Living Room, Outdoor, Entertainment, Laundry sections",
    "theNeighborhood": "The Neighborhood section with activities/attractions",
    "houseRules": "House Rules section",
    "guestAccess": "Guest Access section",
    "otherThingsToNote": "Other Things to Note section",
    "interactionWithGuests": "Interaction with Guests section"
}`;
    }

    private buildUserPrompt(data: PropertyDataForGeneration, additionalNotes?: string): string {
        let prompt = `Please generate listing descriptions for the following property:

## Property Details
- Property Type: ${data.propertyType || "Not specified"}
- Current Listing Name: ${data.externalListingName || data.internalListingName || "Not specified"}
- Location: ${data.city || ""}, ${data.state || ""}, ${data.country || ""}

## Capacity & Rooms
- Maximum Capacity: ${data.personCapacity || "Not specified"} guests
- Bedrooms: ${data.bedroomsNumber || 0}
- Full Bathrooms: ${data.bathroomsNumber || 0}
- Half Bathrooms: ${data.guestBathroomsNumber || 0}
- Size: ${data.squareFeet ? data.squareFeet + " sq ft" : (data.squareMeters ? data.squareMeters + " sq m" : "Not specified")}

## Bed Configuration
${data.bedTypes.length > 0 ? data.bedTypes.map(bt => `- ${bt.bedroomName}: ${bt.quantity}x ${bt.bedType}`).join("\n") : "- Not specified"}

## Bathroom Details
${data.bathroomLocations.length > 0 ? data.bathroomLocations.map(bl => `- ${bl.bathroomName}: ${bl.bathroomType}`).join("\n") : "- Not specified"}

## Amenities
${data.amenities.length > 0 ? data.amenities.map(a => `- ${a}`).join("\n") : "- None specified"}

## House Rules
- Pets Allowed: ${data.allowPets === true ? "Yes" : data.allowPets === false ? "No" : "Not specified"}
${data.allowPets && data.petFee ? `- Pet Fee: $${data.petFee}` : ""}
${data.allowPets && data.numberOfPetsAllowed ? `- Max Pets: ${data.numberOfPetsAllowed}` : ""}
- Smoking Allowed: ${data.allowSmoking === true ? "Yes" : data.allowSmoking === false ? "No" : "Not specified"}
- Parties/Events Allowed: ${data.allowPartiesAndEvents === true ? "Yes" : data.allowPartiesAndEvents === false ? "No" : "Not specified"}
- Children/Infants Allowed: ${data.allowChildreAndInfants === true ? "Yes" : data.allowChildreAndInfants === false ? "No" : "Not specified"}
${data.otherHouseRules ? `- Additional Rules: ${data.otherHouseRules}` : ""}

## Parking
${data.parkingInfo.length > 0 ? data.parkingInfo.map(p => `- ${p.parkingType}: ${p.numberOfSpots} spots (${p.isFree ? "Free" : "Paid"})`).join("\n") : "- No parking info"}
${data.parkingInstructions ? `- Instructions: ${data.parkingInstructions}` : ""}

## Check-in/Check-out
- Check-in: ${data.checkInTimeStart !== null ? `${data.checkInTimeStart}:00` : "Flexible"} - ${data.checkInTimeEnd !== null ? `${data.checkInTimeEnd}:00` : "Flexible"}
- Check-out: ${data.checkOutTime !== null ? `${data.checkOutTime}:00` : "Flexible"}
- Check-in Method: ${data.checkInProcess.length > 0 ? data.checkInProcess.join(", ") : "Not specified"}
- Door Lock: ${data.doorLockType.length > 0 ? data.doorLockType.join(", ") : "Not specified"}

## WiFi
- Available: ${data.wifiAvailable || "Not specified"}
- Speed: ${data.wifiSpeed || "Not specified"}

## Climate Control
- Air Conditioning: ${data.hasAC ? "Yes" : "Not confirmed"}
- Heating: ${data.hasHeating ? "Yes" : "Not confirmed"}

## Pool/Hot Tub
${data.swimmingPoolNotes ? `- Pool: ${data.swimmingPoolNotes}` : ""}
${data.hotTubInstructions ? `- Hot Tub: ${data.hotTubInstructions}` : ""}`;

        // Add additional notes if provided
        if (additionalNotes && additionalNotes.trim()) {
            prompt += `\n\n## Additional Notes from User\n${additionalNotes.trim()}`;
        }

        prompt += `\n\nPlease generate comprehensive listing descriptions following the rule set provided. Make sure all sections are complete and properly formatted.`;

        return prompt;
    }

    /**
     * Generate only titles for a property
     */
    async generateTitlesOnly(propertyId: string, additionalNotes?: string): Promise<string[]> {
        const propertyData = await this.getPropertyDataForGeneration(propertyId);

        if (!propertyData) {
            throw new Error(`Property with ID ${propertyId} not found or has no property info`);
        }

        // Identify key amenities/features for title prioritization
        const amenities = propertyData.amenities || [];
        const hasPool = amenities.some(a => a.toLowerCase().includes('pool'));
        const hasHotTub = amenities.some(a => a.toLowerCase().includes('hot tub') || a.toLowerCase().includes('jacuzzi'));
        const hasGameRoom = amenities.some(a => a.toLowerCase().includes('game room') || a.toLowerCase().includes('pool table') || a.toLowerCase().includes('arcade'));
        const hasFirePit = amenities.some(a => a.toLowerCase().includes('fire pit'));
        const hasBeachAccess = amenities.some(a => a.toLowerCase().includes('beach') || a.toLowerCase().includes('waterfront'));
        const hasGym = amenities.some(a => a.toLowerCase().includes('gym') || a.toLowerCase().includes('fitness'));
        const hasTheater = amenities.some(a => a.toLowerCase().includes('theater') || a.toLowerCase().includes('theatre') || a.toLowerCase().includes('projector'));
        const hasOutdoorKitchen = amenities.some(a => a.toLowerCase().includes('outdoor kitchen') || a.toLowerCase().includes('bbq') || a.toLowerCase().includes('grill'));

        const keyFeatures: string[] = [];
        if (hasPool) keyFeatures.push('Pool');
        if (hasHotTub) keyFeatures.push('Hot Tub');
        if (hasGameRoom) keyFeatures.push('Game Room');
        if (hasFirePit) keyFeatures.push('Fire Pit');
        if (hasBeachAccess) keyFeatures.push('Beach Access');
        if (hasGym) keyFeatures.push('Gym');
        if (hasTheater) keyFeatures.push('Theater');
        if (hasOutdoorKitchen) keyFeatures.push('Outdoor Kitchen/BBQ');

        let userContent = `Generate 3-5 Airbnb listing titles for this property.

## Property Data
- Property Type: ${propertyData.propertyType || "Vacation Rental"}
- Bedrooms: ${propertyData.bedroomsNumber || 0}
- Bathrooms: ${propertyData.bathroomsNumber || 0} full, ${propertyData.guestBathroomsNumber || 0} half
- Maximum Capacity: ${propertyData.personCapacity || 0} guests

## Key Features (prioritize these in titles)
${keyFeatures.length > 0 ? keyFeatures.map(f => `- ${f}`).join('\n') : '- No standout features identified'}

## All Amenities
${amenities.slice(0, 15).join(', ') || 'None specified'}`;

        if (additionalNotes && additionalNotes.trim()) {
            userContent += `\n\n## Additional Notes from User\n${additionalNotes.trim()}`;
        }

        const systemPrompt = `You are a professional Airbnb listing title writer for Luxury Lodging. Generate compelling titles that maximize bookings.

## CHARACTER LIMITS
- Maximum: 50 characters per title
- Priority zone: First 35-40 characters (shows on mobile search)

## TITLE PRINCIPLES - DO
✓ Lead with the #1 booking driver (pool, hot tub, game room, etc.)
✓ Use clean separators: • (bullet) or / (slash) or + (plus)
✓ Stack 2-3 standout features maximum
✓ Include capacity ONLY if >16 guests (e.g., "Sleeps 20")
✓ Match title to what photos would show

## TITLE PRINCIPLES - DON'T
✗ NO location or city names
✗ NO emojis
✗ NO clichés ("Chic Cottage", "Cozy Cabin", "Hidden Gem")
✗ NO alliteration ("Peaceful Paradise", "Serene Stay")
✗ NO generic adjectives (Cozy, Spacious, Beautiful) unless truly luxury-tier
✗ NO mentioning "1 Bedroom" or "Sleeps 2" (not selling points)
✗ NO overloading with features (max 3)

## TITLE FORMULAS (use mix of these)

**Formula A: Amenity Stack + Group Fit**
→ For homes mainly about capacity and features
→ Examples: "Heated Pool • Hot Tub • Sleeps 12 / 6 BR"
           "Pool • Game Room • BBQ • Sleeps 10"

**Formula B: Experience + Amenity Pair**
→ For homes that create a vibe or retreat
→ Examples: "Walk to the Beach • Rooftop Terrace"
           "Mountain Retreat • Hot Tub + Fire Pit"

**Formula C: Superlative Hint + Feature Stack**
→ For premium or luxury tier listings
→ Examples: "#1 Rated Mansion • Pool + Theater"
           "Luxury Estate • Heated Pool + Gym"

**Formula D: Theme + Feature(s)**
→ For styled or themed properties
→ Examples: "Entertainment Hub • Game Room + Bar"
           "Family Retreat • Pool + Playground"

## OUTPUT REQUIREMENTS
1. Generate exactly 3-5 title options
2. Each title MUST be under 50 characters
3. Use a variety of the formulas above
4. Lead each title with the strongest booking driver
5. Do NOT start multiple titles the same way

Respond in JSON format: { "titles": ["Title 1", "Title 2", "Title 3", "Title 4", "Title 5"] }`;

        const response = await this.openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent }
            ],
            temperature: 0.8,
            response_format: { type: "json_object" }
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new Error("No response from OpenAI");
        }

        const parsed = JSON.parse(content);
        return parsed.titles || [];
    }

    /**
     * Generate "The Space" description for a property
     */
    async generateTheSpace(propertyId: string, additionalNotes?: string): Promise<string> {
        const propertyData = await this.getPropertyDataForGeneration(propertyId);

        if (!propertyData) {
            throw new Error(`Property with ID ${propertyId} not found or has no property info`);
        }

        const amenities = propertyData.amenities || [];

        // Build detailed property info for The Space section
        let userContent = `Generate "The Space" section for this Airbnb listing.

## Property Overview
- Property Type: ${propertyData.propertyType || "Vacation Rental"}
- Size: ${propertyData.squareFeet ? propertyData.squareFeet + " sq ft" : (propertyData.squareMeters ? propertyData.squareMeters + " sq m" : "Not specified")}
- Maximum Capacity: ${propertyData.personCapacity || 0} guests

## Bedrooms (${propertyData.bedroomsNumber || 0} total)
${propertyData.bedTypes.length > 0
                ? propertyData.bedTypes.map(bt => `- ${bt.bedroomName}: ${bt.quantity}x ${bt.bedType}`).join('\n')
                : '- Bedroom details not specified'}

## Bathrooms
- Full Bathrooms: ${propertyData.bathroomsNumber || 0}
- Half Bathrooms: ${propertyData.guestBathroomsNumber || 0}
${propertyData.bathroomLocations.length > 0
                ? propertyData.bathroomLocations.map(bl => `- ${bl.bathroomName}: ${bl.bathroomType}${bl.features.length > 0 ? ' (' + bl.features.join(', ') + ')' : ''}`).join('\n')
                : ''}

## Amenities
${amenities.length > 0 ? amenities.map(a => `- ${a}`).join('\n') : '- None specified'}

## Parking
${propertyData.parkingInfo.length > 0
                ? propertyData.parkingInfo.map(p => `- ${p.parkingType}: ${p.numberOfSpots} spots (${p.isFree ? "Free" : "Paid"})`).join('\n')
                : '- No parking info'}

## Climate
- Air Conditioning: ${propertyData.hasAC ? "Yes" : "Not confirmed"}
- Heating: ${propertyData.hasHeating ? "Yes" : "Not confirmed"}

## WiFi
- Available: ${propertyData.wifiAvailable || "Not specified"}
- Speed: ${propertyData.wifiSpeed || "Not specified"}

## Pool/Hot Tub Notes
${propertyData.swimmingPoolNotes ? `- Pool: ${propertyData.swimmingPoolNotes}` : ''}
${propertyData.hotTubInstructions ? `- Hot Tub: ${propertyData.hotTubInstructions}` : ''}

## Pet Policy
- Pets Allowed: ${propertyData.allowPets === true ? "Yes" : propertyData.allowPets === false ? "No" : "Not specified"}`;

        if (additionalNotes && additionalNotes.trim()) {
            userContent += `\n\n## Additional Notes from User\n${additionalNotes.trim()}`;
        }

        const systemPrompt = `You are a professional Airbnb listing copywriter for Luxury Lodging. Generate "The Space" section following these exact formatting rules.

## FORMATTING RULES
- Use ▪️ for main bullet points
- Use ✔️ for checkmarks/sub-items
- Use "w/" for "with"
- NO em dashes (use regular hyphens)
- NO emojis except ▪️ and ✔️

## SECTION STRUCTURE
Generate the following sections in order (only include sections with available data):

### ⭐ HIGHLIGHTS ⭐
Output a single bullet list with this exact format and order:
▪️ [X] Bedrooms: [bed configuration]
▪️ [X] Full, [X] Half Bathrooms w/ Complimentary Toiletries
▪️ Fully Equipped Kitchen
▪️ Spacious Living Area
▪️ [Outdoor features if any]: Hot Tub, BBQ Grill, etc.
▪️ Entertainment: [features if any]
▪️ Free Wi-Fi w/ [feature]
▪️ Centralized Air Conditioning & Heating (adjust based on data)
▪️ Family-friendly Amenities (only if applicable)
▪️ On-site Washer and Dryer (only if applicable)
▪️ [Parking info]
▪️ Pets are welcome! (only if pets allowed)
▪️ Maximum Capacity: [X]

End with: "Note: Before booking, please ensure that you have reviewed the \\"Other Things to Note\\" and \\"House Rules\\" sections."

### ⭐ BEDROOMS ⭐
[Creative summary paragraph]
[Common amenities with ✔️]
[Each bedroom with ▪️ header and ✔️ details]

### ⭐ BATHROOMS ⭐
[Creative summary paragraph]
[Common amenities with ✔️]
[Each bathroom with ▪️ header and ✔️ details]

### ⭐ KITCHEN & DINING ⭐
[Creative summary paragraph]
[Appliances and features with ✔️]

### ⭐ LIVING ROOM ⭐
[Creative summary with features]

### ⭐ OUTDOOR SPACE ⭐
[Only if outdoor amenities exist]

### ⭐ ENTERTAINMENT ⭐
[Only if entertainment amenities exist]

### ⭐ LAUNDRY ⭐
[Standard text if washer/dryer exists]

End with closing CTA:
✨Don't miss out on this fantastic vacation home! Book now to experience the best of [city] with all the comforts of a home away from home. ✨

Respond in JSON format: { "theSpace": "Full formatted text here" }`;

        const response = await this.openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent }
            ],
            temperature: 0.7,
            response_format: { type: "json_object" }
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new Error("No response from OpenAI");
        }

        const parsed = JSON.parse(content);
        return parsed.theSpace || "";
    }

    /**
     * Generate "The Neighborhood" description for a property
     */
    async generateTheNeighborhood(propertyId: string, additionalNotes?: string): Promise<string> {
        const propertyData = await this.getPropertyDataForGeneration(propertyId);

        if (!propertyData) {
            throw new Error(`Property with ID ${propertyId} not found or has no property info`);
        }

        let userContent = `Generate "The Neighborhood" section for this Airbnb listing.

## Property Location
- City: ${propertyData.city || "Not specified"}
- State: ${propertyData.state || "Not specified"}
- Country: ${propertyData.country || "Not specified"}
- Address: ${propertyData.address || "Not specified"}

## Property Type
${propertyData.propertyType || "Vacation Rental"}`;

        if (additionalNotes && additionalNotes.trim()) {
            userContent += `\n\n## Additional Notes from User\n${additionalNotes.trim()}`;
        }

        const systemPrompt = `You are a professional Airbnb listing copywriter for Luxury Lodging. Generate "The Neighborhood" section following these exact rules.

## RULES FROM RULESET
1. **Distance range**: Recommend activities within 20-30 miles of the property
2. **Include distances**: Each activity must include approximate mileage
3. **Verified only**: Only suggest common/typical attractions for the area
4. **No fillers**: If unable to suggest attractions, keep section minimal

## FORMATTING
- Use ▪️ for bullet points
- NO em dashes (use regular hyphens)
- NO emojis except ▪️

## SECTION STRUCTURE

### ⭐ ACTIVITIES/ATTRACTIONS ⭐

Start with this intro paragraph:
"Get ready for endless fun and excitement! From outdoor adventures to unique local attractions, there's always something to explore nearby. Whether you're into shopping, dining, or soaking up the local culture, you'll find plenty of ways to make your stay unforgettable!"

Then list 5-8 nearby attractions with distances:
▪️ [Attraction Name] - [X] miles
▪️ [Attraction Name] - [X] miles
▪️ [Attraction Name] - [X] miles
▪️ [Attraction Name] - [X] miles
▪️ [Attraction Name] - [X] miles

## CONTENT GUIDELINES
- Include a mix of: restaurants, shopping, outdoor activities, entertainment, beaches/parks, tourist attractions
- Base suggestions on typical attractions for the city/state provided
- Use realistic distance estimates based on the location
- Focus on popular, well-known attractions in the area

Respond in JSON format: { "theNeighborhood": "Full formatted text here" }`;

        const response = await this.openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent }
            ],
            temperature: 0.7,
            response_format: { type: "json_object" }
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new Error("No response from OpenAI");
        }

        const parsed = JSON.parse(content);
        return parsed.theNeighborhood || "";
    }
}
