import axios from "axios";
import { createHash } from "crypto";

const clientId = process.env.SCIENER_CLIENT_ID;
const clientSecret = process.env.SCIENER_CLIENT_SECRET;

export class SifelyClient {

  public async getaccestoken(username: string, password: string) {
    // hash the password using md5
    const md5Hash = createHash("md5");
    md5Hash.update(password, "utf-8");
    const hashedPassword = md5Hash.digest("hex");

    const apiUrl = `https://euapi.ttlock.com/oauth2/token`;
    const body = {
      clientId,
      clientSecret,
      username,
      password: hashedPassword,
    };

    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };
    const result = await axios.post(apiUrl, body, config);

    return result.data;
  }

  public async getLockList(access_token: string, pageNo: number, pageSize: number, date: number) {
    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };
    const apiUrl = `https://euapi.sciener.com/v3/lock/list?clientId=${clientId}&accessToken=${access_token}&pageNo=${pageNo}&pageSize=${pageSize}&date=${date}`;

    const result = await axios.get(apiUrl, config);
    return result.data;
  }

  public async getLockInfo(access_token: string, lockId: string, date: number) {
    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };
    const apiUrl = `https://euapi.sciener.com/v3/lock/detail?clientId=${clientId}&accessToken=${access_token}&lockId=${lockId}&date=${date}`;
    const result = await axios.get(apiUrl, config);
    return result.data;
  }

  public async createPasscode(accessToken: string, lockId: string, name: string, code: number) {
    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };

    const body = {
      clientId,
      accessToken,
      lockId,
      keyboardPwdName: name,
      keyboardPwd: code,
    };

    const apiUrl = `https://euapi.sciener.com/v3/keyboardPwd/add`;
    const result = await axios.post(apiUrl, body, config);
    return result.data;
  }

  public async getAllPassCode(accessToken: string, lockId: string, pageNo: number, pageSize: number, date: Date) {
    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };

    const apiUrl = `https://euapi.sciener.com/v3/lock/listKeyboardPwd?clientId=${clientId}&accessToken=${accessToken}&lockId=${lockId}&pageNo=${pageNo}&pageSize=${pageSize}&date=${date}`;
    const result = await axios.get(apiUrl, config);
    return result.data;
  }
}
