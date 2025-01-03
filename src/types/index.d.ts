export type LoginCredentials = {
  email: string;
  password: string;
};

export type IListingPageElementChildren = {
  tagName: string;
  className: string;
  id: string;
  text: string;
};
export type IListingPageElementData = {
  parent: string;
  children: IListingPageElementChildren[];
};
