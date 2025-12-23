# OpenAI Listing Description Generation - Rule Set

> This rule set is compiled from the provided guides: **Listing Description Bot – Instruction Guide**, **Title & Photo Order Guide**, and **Hostify Listing Description Template**.

---

## 1. General Rules

### 1.1 Formatting Standards
| Rule | Description |
|------|-------------|
| **No em dashes** | Use normal hyphens (`-`) when needed |
| **No emojis** | Exception: Use only `▪️` for bullet points and `✔️` for checkmarks as shown in template |
| **Clean formatting** | Consistent, clear structure throughout |
| **Data integrity** | Only use information from the property database; never assume or fabricate features |
| **Missing data** | If information is missing, omit the section entirely without placeholders |
| **Inconsistencies** | Flag any data inconsistencies in ALL CAPS for human review |

---

## 2. Listing Title Rules

### 2.1 Character Limits
- **Maximum**: 50 characters
- **Priority zone**: First 35-40 characters (shows on mobile)

### 2.2 Title Principles
| Do | Don't |
|-----|-------|
| Lead with the #1 booking driver | Use location/city names |
| Use clean separators: `•` or `/` | Use emojis or clutter |
| Stack 2-3 standout features max | Overload with features |
| Match title to photos | Use clichés ("Chic Cottage", "Cozy Cabin") |
| Include capacity if >16 guests | Use adjectives (Cozy, Spacious) unless truly luxury |
| | Mention 1 Bedroom or Sleeps 2 (not selling points) |

### 2.3 Title Formulas

```
Formula A: Amenity Stack + Group Fit
→ Use when home is mainly about capacity and features
→ Example: "Heated Pool • Hot Tub • Sleeps 12 / 6 BR"

Formula B: Experience + Amenity Pair  
→ Use when home creates a vibe or retreat with 1-2 marquee features
→ Example: "Walk to the Beach • Rooftop Terrace + Fire Pit"

Formula C: Superlative Hint + Feature Stack
→ Use for premium or luxury tier listings
→ Example: "#1 Rated Mansion • Pool + Theater • Sleeps 14"

Formula D: Theme + Feature(s)
→ Use when property has a style or theme
→ Example: "Entertainment Hub • Game Room + Bar • Sleeps 10"
```

### 2.4 Output Requirement
- Generate **3-5 title options** per property
- Each must follow character limits and formatting rules

---

## 3. Listing Summary Rules

### 3.1 Specifications
- **Maximum characters**: 500
- **Tone**: Engaging, professional, welcoming
- **Structure**: Follow template style exactly

---

## 4. The Space Section

### 4.1 Highlights Section Format

> **IMPORTANT**: Always output a single bullet list using this exact format:
> - Bullet symbol: `▪️`
> - One space after bullet
> - Short label, then colon if listing details
> - Use concise text with commas, and "w/" for "with"

#### Bullet Order (only include if applicable):

| Order | Format | Example |
|-------|--------|---------|
| 1 | Bedrooms | `▪️ 3 Bedrooms: 1x Queen Bed, 1x Full Bed, 2x Twin Bunk Beds` |
| 2 | Bathrooms | `▪️ 2 Full Bathrooms w/ Complimentary Toiletries` or `▪️ 2 Full, 1 Half Bathrooms w/ Complimentary Toiletries` |
| 3 | Kitchen | `▪️ Fully Equipped Kitchen` (keep short) |
| 4 | Living Area | `▪️ Spacious Living Area` or `▪️ Spacious Living Area: 1 Queen Sofa Bed, 70 inch Smart TV, Indoor Fireplace` |
| 5 | Outdoor | `▪️ Spacious Outdoor: Hot Tub, BBQ Grill, Fire Pit, Outdoor Dining` |
| 6 | Entertainment | `▪️ Entertainment: Loft Game Room, Pool Table, Air Hockey, Ping Pong` |
| 7 | Wi-Fi | `▪️ Free Wi-Fi w/ Dedicated Workspace` or `▪️ Free Wi-Fi w/ Smart TVs for Streaming` |
| 8 | Climate | `▪️ Centralized Air Conditioning & Heating` (adjust if only heat/AC) |
| 9 | Family Amenities | `▪️ Family-friendly Amenities: Pack 'n Play, high chair` (only if provided) |
| 10 | Laundry | `▪️ On-site Washer and Dryer` (only if provided) |
| 11 | Parking | `▪️ Free Driveway Parking (4 vehicles)` or `▪️ Free Driveway (2 vehicles/cars) and Street Parking (first-come, first-served)` |
| 12 | Pets | `▪️ Pets are welcome!` (only if allowed; if not allowed, omit entirely) |
| 13 | Capacity | `▪️ Maximum Capacity: 10` |

#### Add Note After Highlights:
```
Note: Before booking, please ensure that you have reviewed the "Other Things to Note" and "House Rules" sections.
```

### 4.2 Bedrooms Section
**Header**: `⭐ BEDROOMS ⭐`

**Format**:
```
[Creative summary - enticing, experience-focused]
[Common bedroom amenities with ✔️]
✔️ Clothing Storage
✔️ Room Darkening Shade

▪️ Master Bedroom: King Bed - ensuite to Full Bathroom #1
✔️ Sleeps 2
✔️ Balcony access
✔️ 40" Smart TV

▪️ Bedroom 2: Queen Bed 
✔️ Sleeps 3
✔️ Ceiling Fan
✔️ Sofabed

▪️ Extra Sleeping Space:
✔️ Living Room Sofa - Sleeps 1
✔️ Queen Air Mattress - Sleeps 2
```

### 4.3 Bathrooms Section
**Header**: `⭐ BATHROOMS ⭐`

**Format**:
```
[Creative summary]
[Common bathroom amenities with ✔️]
✔️ Fresh Towels and Linens 
✔️ Complimentary Toiletries
✔️ Hair Dryer

▪️ Bathroom 1: Full Bathroom - ensuite Master Bedroom 
✔️ Shower & Bathtub

▪️ Bathroom 2: Full Bathroom 
✔️ Shower & Tub Combo

▪️ Bathroom 3: Half Bathroom
```

### 4.4 Kitchen & Dining Section
**Header**: `⭐ KITCHEN & DINING ⭐`

**Format**:
```
[Creative summary]
✔️ Refrigerator w/ Freezer, Stove, Oven, Microwave 
✔️ Toaster, Blender, Crockpot, Ice Maker, Rice Maker
✔️ Drip Coffee Maker, Coffee Grounds, Coffee Pods (Keurig) ☕️
✔️ Dishwasher, Dinnerware, and Silverware
✔️ Essential Cooking & BBQ Utensils + Spices 
✔️ Stocked with Basic Supplies: Paper Towels, Cleaning Supplies, Trash Bags, etc.
✔️ Spacious Dining Table for 6 & Breakfast Bar for 4
```

### 4.5 Living Room Section
**Header**: `⭐ LIVING ROOM ⭐`

### 4.6 Outdoor Space Section
**Header**: `⭐ OUTDOOR SPACE ⭐`

### 4.7 Entertainment Section
**Header**: `⭐ ENTERTAINMENT ⭐`

**Format**:
```
[Creative summary]
▪️ Gym Area
✔️ Treadmill
✔️ Dumbbells and Barbell

▪️ Indoor/Outdoor Fireplace

▪️ Games
✔️ Pool Table
✔️ PingPong Table
✔️ Board Games
```

### 4.8 Laundry Section
**Header**: `⭐ LAUNDRY ⭐`

**Standard text**:
```
Our convenient laundry area makes keeping up with chores effortless. Equipped with essential appliances, it's designed to handle your laundry needs efficiently and seamlessly.
✔️ Washer and Dryer
✔️ Laundry Detergent 
✔️ Iron and Ironing Board
```

### 4.9 Closing CTA
```
✨Don't miss out on this fantastic vacation home! Book now to experience the best of [city name] with all the comforts of a home away from home. ✨

✨Book Today & Let Us Take Care Of You In [city name]! ✨
```

---

## 5. Interaction with Guests Section

**Standard text**:
```
✔️ We are available 24/7
```

---

## 6. The Neighborhood Section

### 6.1 Activities/Attractions Rules
**Header**: `⭐ ACTIVITIES/ATTRACTIONS ⭐`

| Rule | Description |
|------|-------------|
| **Distance range** | Recommend activities within 20-30 miles of property |
| **Include distances** | Each activity must include approximate mileage |
| **Verified only** | Only include activities verifiable based on property address |
| **No fillers** | If no activities found, leave section blank |

**Format**:
```
Get ready for endless fun and excitement! From outdoor adventures to unique local attractions, there's always something to explore nearby. Whether you're into shopping, dining, or soaking up the local culture, you'll find plenty of ways to make your stay unforgettable!

▪️ [Activity 1] - [X] miles
▪️ [Activity 2] - [X] miles
▪️ [Activity 3] - [X] miles
▪️ [Activity 4] - [X] miles
▪️ [Activity 5] - [X] miles
```

---

## 7. House Rules Section

> **CAUTION**: Keep House Rules as-is or with minimal edits only.

### 7.1 Standard Rules (always include):
```
▪️ Unregistered guests are not allowed.
▪️ No smoking within the property's premises.
▪️ No parties, events, or large gatherings allowed. 
▪️ Please observe quiet hours from 9PM to 8AM.
▪️ Respect the neighbors. Do not park on their premises or cause any disturbances.
▪️ Respect the home. Do not break or damage anything. Maintain cleanliness throughout your stay.
▪️ Do not flush anything down the toilet to avoid plumbing issues.
▪️ Follow the check-in/check-out instructions. Guests will be held responsible for any issues that arise from not adhering to these instructions.
▪️ Adhere to the standard check-in and check-out time. Early check-in and late checkout are subject to the host's approval. 
▪️ All furniture, appliances, and items should be returned to their original place. Missing and/or damaged items may result in additional charges.
▪️ View Rental Agreement, Photo ID, and Security Deposit may be required upon check-in.
▪️ We reserve the right to charge a fee if ANY of the policy is violated.
```

### 7.2 Pet Rules (choose based on property settings):

**If pets allowed (no fee)**:
```
▪️ Pets are welcome, but must be registered and reported to the host. Max # of pets: [X]. Host should be informed if you have a service animal. Ensure that they are well-behaved and that you take necessary precautions to prevent any damage and extra cleaning. Pet/Service Animals owners will be responsible for any extra cleaning fees or damages caused.
```

**If pets NOT allowed**:
```
▪️ Strictly no pets (including ESA) allowed. Host should be informed if you have a service animal.
```

**If pets allowed (with fee)**:
```
▪️ Pets are welcome with a fee. Max # of pets: [X]. Allowed Pets: [size/variation]. Pets must be registered and reported to the host. Host should also be informed if you have a service animal. Ensure that they are well-behaved and that you take necessary precautions to prevent any damage and extra cleaning. Pet/Service Animal owners will be responsible for any extra cleaning fees or damages caused.
```

---

## 8. House Manual Section

> **NOTE**: This section always uses the same static text.

### Standard Text (Always Use):
```
Your check-in instructions will be sent on the day of arrival, and your check-out instructions will be sent either on the day of departure or the day before. Please review and follow both carefully.
```

---

## 9. Guest Access Section

### 8.1 General Access
**If Fully Private Access**:
```
✔️ GENERAL: Guests can enjoy full access to the whole property and its amenities. Long-term stays are allowed.
```

**If Shared Access**:
```
✔️ GENERAL: Some amenities have shared access. All other areas of the home are fully private. Long-term stays are allowed.
```

### 8.2 Check-in Method
**For Electronic/Smart lock**:
```
✔️ KEYLESS SELF CHECK IN: Access the property easily with our keyless entry system using a keypad. The access code will be provided to you on/before check-in.
```

**For Lockbox**:
```
✔️ SELF CHECK IN: Enjoy hassle-free entry with our lockbox. A code will be sent to you on/before check-in.
```

### 8.3 Parking
```
✔️ PARKING: [Parking details from property data]
```

### 8.4 Standard Closing
```
✔️ We'll provide detailed check-in & check-out instructions and are available to answer any questions you may have about the property or the surrounding area.
```

---

## 9. Other Things to Note Section

### 9.1 Standard Items
```
▪️ We use ChargeAutomation to provide a secure guest portal, which can be shared with your group and adds an extra layer of verification to prevent fraudulent bookings. You'll receive this link after your booking is confirmed.

▪️ We hold a security deposit during your stay, which will be fully refunded after check-out, provided there are no damages to the property.

▪️ Please take a moment to read our House Rules in the House Rules section.

▪️ This property comfortably accommodates up to [actual capacity] guests, but we are happy to consider hosting up to [maximum capacity] guests if needed.
```

### 9.2 Conditional Items (add if applicable):

| Condition | Text |
|-----------|------|
| **Extra guest charge** | `There is an additional fee above [X] guests. Kindly register the correct total number of guests.` |
| **Regular maintenance** | `▪️ This property may have regular maintenance (e.g., lawn, pool, pest control) during your stay. If you'd prefer no service during your visit, just let us know in advance.` |
| **Pool/Hot tub** | `▪️ Pool and hot tub heating is available for an additional fee. To have the pool ready and warm for your arrival, please give us at least 48 hours' notice.` |
| **Pool/Hot tub temp** | `▪️ We'd like to set your expectations that the (heated pool/hot tub) temperature will be determined by the weather temperature.` |
| **Pack 'n Play/High chair** | `▪️ Traveling with little ones? We've got you covered with a Pack 'n Play and/or high chair available upon request. Fees may apply.` |
| **Security cameras** | `▪️ Surveillance or recording devices on property. We use a noise monitoring device, which does NOT record actual sounds or conversations. Video recording devices only monitor the exterior of the home.` |
| **Early check-in/Late checkout** | `▪️ We offer options for early check-in and late check-out, subject to availability and fees.` |
| **Other upsells** | `▪️ Mid-stay cleaning and other concierge services are available upon request for an additional fee.` |
| **Near body of water** | `▪️ We're delighted to welcome you to our beautiful property, located near a body of water. [Include wildlife/pest control note for Florida properties]` |

---

## 10. Data Source Mapping

The following fields from the property database will be used to generate each section:

| Description Section | Database Fields |
|---------------------|-----------------|
| **Title** | `externalListingName`, `propertyType`, `bedroomsNumber`, `personCapacity`, `amenities` |
| **Summary** | All property info combined |
| **Highlights - Bedrooms** | `bedroomsNumber`, `propertyBedTypes` |
| **Highlights - Bathrooms** | `bathroomsNumber`, `guestBathroomsNumber`, `propertyBathroomLocation` |
| **Highlights - Kitchen** | `amenities` (kitchen-related) |
| **Highlights - Outdoor** | `amenities` (pool, hot tub, BBQ, etc.) |
| **Highlights - Entertainment** | `amenities` (game room, etc.), `exerciseEquipmentTypes` |
| **Highlights - Wi-Fi** | `wifiAvailable`, `wifiSpeed` |
| **Highlights - Climate** | `amenities` (AC, heating) |
| **Highlights - Parking** | `propertyParkingInfo`, `parkingInstructions` |
| **Highlights - Pets** | `allowPets`, `petFee`, `numberOfPetsAllowed` |
| **Highlights - Capacity** | `personCapacity` |
| **House Rules** | `allowPets`, `allowSmoking`, `allowPartiesAndEvents`, `otherHouseRules` |
| **Guest Access** | `checkInProcess`, `doorLockType`, `propertyParkingInfo` |
| **Neighborhood** | `address`, `city`, `state` (for nearby attractions lookup) |

---

## 11. Output Format Summary

When generating, produce:

1. **3-5 Title Options** (50 chars max each)
2. **Listing Summary** (500 chars max)
3. **The Space** (Highlights → Bedrooms → Bathrooms → Kitchen → Living Room → Outdoor → Entertainment → Laundry → CTA)
4. **Interaction with Guests**
5. **The Neighborhood** (with verified nearby attractions)
6. **House Rules** (from template with conditions applied)
7. **Guest Access** (based on property access type)
8. **Other Things to Note** (based on applicable conditions)
