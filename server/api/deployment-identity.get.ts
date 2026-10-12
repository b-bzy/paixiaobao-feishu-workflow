import {
  DeploymentIdentityUnavailableError,
  getDeploymentIdentity,
} from "~/lib/deployment-identity";

export default defineEventHandler((event) => {
  try {
    return { code: 0, result: getDeploymentIdentity() };
  } catch (error) {
    if (!(error instanceof DeploymentIdentityUnavailableError)) throw error;
    setResponseStatus(event, 503);
    return { code: 1, message: "Deployment identity is unavailable" };
  }
});
