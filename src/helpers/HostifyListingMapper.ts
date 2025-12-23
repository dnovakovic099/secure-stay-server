import { ClientPropertyEntity } from "../entity/ClientProperty";
import { PropertyInfo } from "../entity/PropertyInfo";
import { PropertyBedTypes } from "../entity/PropertyBedTypes";
import { PropertyServiceInfo } from "../entity/PropertyServiceInfo";
import { PropertyVendorManagement } from "../entity/PropertyVendorManagement";
import { PropertyBathroomLocation } from "../entity/PropertyBathroomLocation";
import {
    HostifyPropertyTypes,
    HostifyListingTypes,
    HostifyBedTypes,
    HostifyRoomTypes,
    HostifyAmenities,
} from "../constant";
import logger from "../utils/logger.utils";

/**
 * Helper class to map ClientProperty data to Hostify API format
 */
export class HostifyListingMapper {

    /**
     * Map property data to Hostify location payload (Step 1)
     */
    static mapToLocation(
        property: ClientPropertyEntity,
        propertyInfo: PropertyInfo,
        serviceInfo?: PropertyServiceInfo | null,
        vendorManagement?: PropertyVendorManagement | null
    ) {
        const propertyType = this.mapPropertyType(propertyInfo.propertyType);
        const listingType = this.mapListingType(propertyInfo.roomType);

        // Build tags array based on property data
        const tags: string[] = ["pm"];

        // Add management fee tag (e.g., "25%")
        if (serviceInfo?.managementFee != null) {
            tags.push(`${serviceInfo.managementFee}%`);
        }

        // Add service type tag (FULL=Full, PRO=Pro, LAUNCH=Launch)
        if (serviceInfo?.serviceType) {
            const serviceTypeMap: Record<string, string> = {
                "FULL": "Full",
                "PRO": "Pro",
                "LAUNCH": "Launch"
            };
            const mappedServiceType = serviceTypeMap[serviceInfo.serviceType.toUpperCase()] || serviceInfo.serviceType;
            tags.push(mappedServiceType);
        }

        // Add claim fee tag
        if (propertyInfo.claimFee === "Yes") {
            tags.push("w/claims fee");
        } else if (propertyInfo.claimFee === "No") {
            tags.push("no claims fee");
        }
        // If claimFee is null or anything else, disregard (don't add tag)

        // Add cleaning tag if cleaner managed by Luxury Lodging
        if (vendorManagement?.cleanerManagedBy === "Luxury Lodging") {
            tags.push("cleaning");
        }

        // Add door code tag if code responsible party is Luxury Lodging
        if (propertyInfo.codeResponsibleParty === "Luxury Lodging") {
            tags.push("door code");
        }

        return {
            name: propertyInfo.internalListingName,
            property_type: propertyType,
            listing_type: listingType,
            lat: property.latitude,
            lng: property.longitude,
            address: property.address || `${property.streetAddress}, ${property.city}, ${property.state}`,
            city: property.city,
            state: property.state,
            country: property.country,
            zipcode: property.zipCode,
            street: property.streetAddress,
            pms_services: 1,
            tags: tags,
        };
    }

    /**
     * Map property layout data to Hostify layout payload (Step 2)
     */
    static mapToLayout(
        listingId: number,
        propertyInfo: PropertyInfo,
        bedTypes: PropertyBedTypes[],
        bathroomLocations?: PropertyBathroomLocation[]
    ) {
        const fullBathrooms = propertyInfo.bathroomsNumber || 0;
        const halfBathrooms = propertyInfo.guestBathroomsNumber || 0;
        const totalBathrooms = fullBathrooms + halfBathrooms;

        return {
            listing_id: listingId,
            person_capacity: propertyInfo.personCapacity,
            area: propertyInfo.squareMeters || propertyInfo.squareFeet,
            area_unit: propertyInfo.squareMeters ? "meter" : "feet",
            bathrooms: totalBathrooms,
            bathroom_shared: propertyInfo.bathroomType === "Shared",
            rooms: this.mapRooms(bedTypes, propertyInfo, bathroomLocations),
        };
    }

    /**
     * Map amenities to Hostify amenities payload (Step 3)
     */
    static mapToAmenities(listingId: number, amenities: string[]) {
        return {
            listing_id: listingId,
            amenities: this.mapAmenityNames(amenities),
        };
    }

    /**
     * Map translations/descriptions to Hostify translations payload (Step 4)
     */
    static mapToTranslations(listingId: number, propertyInfo: PropertyInfo) {
        return {
            listing_id: listingId,
            name: propertyInfo.externalListingName,
            // summary: propertyInfo.internalListingName,
            // house_rules: propertyInfo.otherHouseRules,
            // checkin_place: propertyInfo.checkInInstructions,
            // access: propertyInfo.checkOutInstructions,
        };
    }

    /**
     * Map booking restrictions to Hostify booking restrictions payload (Step 5)
     */
    static mapToBookingRestrictions(listingId: number, propertyInfo: PropertyInfo) {
        return {
            listing_id: listingId,
            price: propertyInfo.price || 3000,
            currency: propertyInfo.currencyCode || "USD",
            occupancy: 1,
            min_stay_default: propertyInfo.minNights,
            max_stay_default: propertyInfo.maxNights,
            checkin_start: propertyInfo.checkInTimeStart ? `${String(propertyInfo.checkInTimeStart).padStart(2, '0')}:00:00` : null,
            checkin_end: propertyInfo.checkInTimeEnd ? `${String(propertyInfo.checkInTimeEnd).padStart(2, '0')}:00:00` : null,
            checkout: propertyInfo.checkOutTime ? `${String(propertyInfo.checkOutTime).padStart(2, '0')}:00:00` : null,
            pets_allowed: propertyInfo.allowPets ? 1 : 0,
            smoking_allowed: propertyInfo.allowSmoking ? 1 : 0,
            children_allowed: propertyInfo.allowChildreAndInfants ? 1 : 0,
            infants_allowed: 1,
        };
    }

    /**
     * Map property type to Hostify property type
     */
    private static mapPropertyType(type: string): string {
        if (!type) return "house";

        const mapped = HostifyPropertyTypes[type];
        if (mapped) return mapped;

        // Try case-insensitive match
        const lowerType = type.toLowerCase();
        for (const [key, value] of Object.entries(HostifyPropertyTypes)) {
            if (key.toLowerCase() === lowerType) {
                return value;
            }
        }

        logger.warn(`Unmapped property type: ${type}, defaulting to 'house'`);
        return "house";
    }

    /**
     * Map room type to Hostify listing type
     */
    private static mapListingType(roomType: string): string {
        if (!roomType) return "entire home";

        const mapped = HostifyListingTypes[roomType];
        if (mapped) return mapped;

        // Try case-insensitive match
        const lowerType = roomType.toLowerCase();
        for (const [key, value] of Object.entries(HostifyListingTypes)) {
            if (key.toLowerCase() === lowerType) {
                return value;
            }
        }

        logger.warn(`Unmapped listing type: ${roomType}, defaulting to 'entire home'`);
        return "entire home";
    }

    /**
     * Map PropertyBedTypes and bathrooms to Hostify rooms array
     */
    private static mapRooms(
        bedTypes: PropertyBedTypes[],
        propertyInfo: PropertyInfo,
        bathroomLocations?: PropertyBathroomLocation[]
    ) {
        const rooms: any[] = [];

        // Map bedrooms
        if (bedTypes && bedTypes.length > 0) {
            // Group by bedroom number
            const bedroomMap = new Map<number, any[]>();

            for (const bedType of bedTypes) {
                const bedroomNum = bedType.bedroomNumber || 1;

                if (!bedroomMap.has(bedroomNum)) {
                    bedroomMap.set(bedroomNum, []);
                }

                const hostifyBedType = this.mapBedType(bedType.bedTypeId);
                logger.info(`Mapping bed type: "${bedType.bedTypeId}" -> "${hostifyBedType}"`);
                bedroomMap.get(bedroomNum)!.push({
                    bed_type: hostifyBedType,
                    bed_number: bedType.quantity || 1,
                });
            }

            // Convert bedroom map to rooms array
            bedroomMap.forEach((beds, bedroomNum) => {
                rooms.push({
                    room_id: "new",
                    name: `Bedroom ${bedroomNum}`,
                    room_type: "bedroom",
                    bed: beds,
                });
            });
        }

        // Map bathrooms
        if (bathroomLocations && bathroomLocations.length > 0) {
            // Use detailed bathroom locations if available
            bathroomLocations.forEach((bathroom, index) => {
                rooms.push({
                    room_id: "new",
                    name: this.getBathroomName(bathroom.bathroomType),
                    room_type: "bathroom",
                    person_capacity: 0,
                    shared: bathroom.privacyType === "Shared" ? 1 : 0,
                });
            });
            logger.info(`Added ${bathroomLocations.length} bathrooms from detailed locations`);
        } else if (propertyInfo.bathroomsNumber > 0 || propertyInfo.guestBathroomsNumber > 0) {
            // Fallback: Use counts if no detailed locations
            const fullBathrooms = propertyInfo.bathroomsNumber || 0;
            const halfBathrooms = propertyInfo.guestBathroomsNumber || 0;

            for (let i = 0; i < fullBathrooms; i++) {
                rooms.push({
                    room_id: "new",
                    name: "Full bathroom",
                    room_type: "bathroom",
                    person_capacity: 0,
                    shared: propertyInfo.bathroomType === "Shared" ? 1 : 0,
                });
            }

            for (let i = 0; i < halfBathrooms; i++) {
                rooms.push({
                    room_id: "new",
                    name: "Half bathroom",
                    room_type: "bathroom",
                    person_capacity: 0,
                    shared: 0,
                });
            }
            logger.info(`Added ${fullBathrooms} full bathrooms and ${halfBathrooms} half bathrooms from counts`);
        }

        return rooms;
    }

    /**
     * Get bathroom name based on type
     */
    private static getBathroomName(bathroomType: string): string {
        if (!bathroomType) return "Full bathroom";
        const lowerType = bathroomType.toLowerCase();
        if (lowerType.includes("half")) return "Half bathroom";
        if (lowerType.includes("full")) return "Full bathroom";
        return bathroomType;
    }

    /**
     * Map bed type ID/name to Hostify bed type
     */
    private static mapBedType(bedTypeId: string): string {
        if (!bedTypeId) return "king_bed";

        const mapped = HostifyBedTypes[bedTypeId];
        if (mapped) return mapped;

        // Try case-insensitive match
        const lowerType = bedTypeId.toLowerCase();
        for (const [key, value] of Object.entries(HostifyBedTypes)) {
            if (key.toLowerCase() === lowerType) {
                return value;
            }
        }

        logger.warn(`Unmapped bed type: ${bedTypeId}, defaulting to 'king_bed'`);
        return "king_bed";
    }

    /**
     * Map amenity IDs/names to Hostify amenity names
     */
    private static mapAmenityNames(amenities: string[]): string[] {
        if (!amenities || amenities.length === 0) return [];

        const mappedAmenities: string[] = [];

        for (const amenity of amenities) {
            const mapped = HostifyAmenities[amenity];
            if (mapped) {
                if (!mappedAmenities.includes(mapped)) {
                    mappedAmenities.push(mapped);
                }
            } else {
                // Try to find a partial match
                let found = false;
                for (const [key, value] of Object.entries(HostifyAmenities)) {
                    if (key.toLowerCase().includes(amenity.toLowerCase()) ||
                        amenity.toLowerCase().includes(key.toLowerCase())) {
                        if (!mappedAmenities.includes(value)) {
                            mappedAmenities.push(value);
                            found = true;
                            break;
                        }
                    }
                }

                if (!found) {
                    logger.warn(`Unmapped amenity: ${amenity}`);
                }
            }
        }

        return mappedAmenities;
    }
}
