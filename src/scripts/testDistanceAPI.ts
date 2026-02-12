
import axios from "axios";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "../../.env") });

async function testDistance() {
  const apiKey = process.env.GOOGLE_API_KEY;
  console.log("Using API Key:", apiKey ? "FOUND" : "NOT FOUND");
  
  const origin = "38.6270,-90.1994"; // St Louis
  const destination = "39.0997,-94.5786"; // Kansas City
  
  try {
    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/distancematrix/json",
      {
        params: {
          origins: origin,
          destinations: destination,
          units: "imperial",
          key: apiKey,
        },
      }
    );
    
    console.log("API Status:", response.data.status);
    if (response.data.rows?.[0]?.elements?.[0]) {
      console.log("Element Status:", response.data.rows[0].elements[0].status);
      console.log("Distance:", response.data.rows[0].elements[0].distance?.text);
      console.log("Duration:", response.data.rows[0].elements[0].duration?.text);
    } else {
      console.log("Full Response:", JSON.stringify(response.data, null, 2));
    }
  } catch (error) {
    console.error("Request Error:", error.message);
  }
}

testDistance();
