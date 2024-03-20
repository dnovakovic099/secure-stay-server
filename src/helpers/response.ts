export const successDataFetch = (data: any) => {
  return {
    success: true,
    message: "Data found successfully!!!",
    data: data,
  };
};

export const dataNotFound = (message: string = "Data not found!!!") => {
  return {
    success: false,
    message: message,
  };
};

export const dataNotExist = (message: string = "Data not Exist!!!") => {
  return {
    success: true,
    message: message,
  };
};

export const logout = () => {
  return {
    success: true,
    message: "Logged out successfully!!!",
  };
};

export const dataSaved = (message: string = "Data saved successfully!!!") => {
  return {
    success: true,
    message: message,
  };
};

export const dataUpdated = (
  message: string = "Data updated successfully!!!"
) => {
  return {
    success: true,
    message: message,
  };
};

export const duplicateData = (message: string = "Duplicate data Found") => {
  return {
    success: false,
    message: message,
  };
};

export const dataDeleted = (message: string = "Data deleted successfully") => {
  return {
    success: true,
    message: message,
  };
};
