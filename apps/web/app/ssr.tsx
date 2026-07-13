import { createStandardSSRHandler } from '@taskforceai/react-core/ssr-handler';
import { getRouter } from './router';

export default createStandardSSRHandler(getRouter);
