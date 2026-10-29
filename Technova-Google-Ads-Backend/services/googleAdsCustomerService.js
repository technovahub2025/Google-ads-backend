const { GoogleAdsApi } = require("google-ads-api");

const {
  getGoogleAdsConnection,
} = require("../model/GoogleAdsConnection");

const getAccessibleCustomerAccounts = async (connectionId) => {
  const connection = await getGoogleAdsConnection(connectionId);

  if (!connection) {
    throw new Error("Google Ads connection not found");
  }

  if (!connection.refreshToken) {
    throw new Error("Google Ads refresh token not found");
  }

  const client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  });

  // google-ads-api exposes Google's CustomerService.listAccessibleCustomers
  // directly, so discovery does not need a preconfigured customer ID.
  const accessibleCustomers = await client.listAccessibleCustomers(
    connection.refreshToken,
  );
  const customerResourceNames = accessibleCustomers.resource_names || [];

  const customerAccounts = await Promise.all(
    customerResourceNames.map(async (resourceName) => {
      const customerId = resourceName.split("/").pop();
      const customer = client.Customer({
        customer_id: customerId,
        refresh_token: connection.refreshToken,
      });

      const [account] = await customer.query(`
        SELECT
          customer.id,
          customer.descriptive_name,
          customer.currency_code,
          customer.time_zone,
          customer.manager
        FROM customer
      `);

      return account;
    }),
  );

  return customerAccounts;
};

module.exports = {
  getAccessibleCustomerAccounts,
};
