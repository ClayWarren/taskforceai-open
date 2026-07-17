package callback

import (
	"github.com/pashagolub/pgxmock/v4"
)

func expectOAuthAccountLock(mock pgxmock.PgxPoolIface) {
	mock.ExpectExec("SELECT PG_ADVISORY_XACT_LOCK").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("SELECT", 1))
}
