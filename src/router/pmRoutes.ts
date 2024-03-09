import { PmController } from "../controllers/PmController";


export const PmRoutes = () => {

    const propertyManagement = new PmController();
    return [
        {
            path: "/pm/saveuserspm",
            method: "post",
            action: propertyManagement.saveUsersPmSoftware,
            file: false,
            rawJson: false
        },
        {
            path: "/pmcompay/saveuserpmcompany",
            method: "post",
            action: propertyManagement.createUserPmSoftware,
            file: false,
            rawJson: false
        },
        {
            path: "/pm/getpmlist",
            method: "get",
            action: propertyManagement.getPropertyManagementList,
            file: false,
            rawJson: false
        },
        {
            path: "/pm/getuserpm",
            method: "get",
            action: propertyManagement.getUserPmSoftwareList,
            file: false,
            rawJson: false
        },
        {
            path: "/pmcompay/userpmlist",
            method: "get",
            action: propertyManagement.getUserPmList,
            file: false,
            rawJson: false
        },
    ];

};