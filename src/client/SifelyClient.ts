import axios from "axios";
import { createHash } from "crypto";
import { generateRandomNumber } from "../helpers/helpers";

export class SifelyClient {
  private clientId = process.env.SCIENER_CLIENT_ID;
  private clientSecret = process.env.SCIENER_CLIENT_SECRET;

  public async getaccestoken(username: string, password: string) {
    // hash the password using md5
    const md5Hash = createHash("md5");
    md5Hash.update(password, "utf-8");
    const hashedPassword = md5Hash.digest("hex");

    const apiUrl = `https://euapi.ttlock.com/oauth2/token`;
    const body = {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      username,
      password: hashedPassword,
    };

    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };
    const result = await axios.post(apiUrl, body, config);
    console.log(result);

    return result.data;
  }

  public async getLockList(
    access_token: string,
    pageNo: number,
    pageSize: number,
    date: number
  ) {
    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };
    const apiUrl = `https://euapi.sciener.com/v3/lock/list?clientId=${this.clientId}&accessToken=${access_token}&pageNo=${pageNo}&pageSize=${pageSize}&date=${date}`;

    const result = await axios.get(apiUrl, config);
    return result.data?.list;
  }

  public async getLockInfo(access_token: string, lockId: string, date: number) {
    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };
    const apiUrl = `https://euapi.sciener.com/v3/lock/detail?clientId=${this.clientId}&accessToken=${access_token}&lockId=${lockId}&date=${date}`;
    const result = await axios.get(apiUrl, config);
    return result.data;
  }

  public async createPasscode(
    accessToken: string,
    lockId: number,
    name: string,
    code: number,
    timingOption: Number,
    startDate: number,
    endDate: number
  ) {
    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };

    const body = {
      clientId: this.clientId,
      accessToken,
      lockId,
      keyboardPwdName: name,
      keyboardPwd: code ? code : generateRandomNumber(4),
      date: new Date().valueOf(),
      startDate: startDate,
      endDate: endDate,
      keyboardPwdType: timingOption,
    };

    const apiUrl = `https://euapi.sciener.com/v3/keyboardPwd/add`;
    const result = await axios.post(apiUrl, body, config);
    return result.data;
  }

  public async getAllPassCode(
    accessToken: string,
    lockId: number,
    pageNo: number,
    pageSize: number,
    date: number
  ) {
    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };

    const apiUrl = `https://euapi.sciener.com/v3/lock/listKeyboardPwd?clientId=${this.clientId}&accessToken=${accessToken}&lockId=${lockId}&pageNo=${pageNo}&pageSize=${pageSize}&date=${date}`;
    const result = await axios.get(apiUrl, config);
    return result.data?.list;
  }

  public async deletePassCode(
    accessToken: string,
    lockId: number,
    keyboardPwdId: number
  ) {
    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };

    const body = {
      clientId: this.clientId,
      accessToken,
      lockId,
      keyboardPwdId,
      date: new Date().valueOf(),
      deleteType: 2,
    };

    const apiUrl = `https://euapi.sciener.com/v3/keyboardPwd/delete`;
    const result = await axios.post(apiUrl, body, config);
    return result.data;
  }
}
