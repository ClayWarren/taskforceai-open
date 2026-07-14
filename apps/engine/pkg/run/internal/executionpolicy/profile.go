package executionpolicy

import "fmt"

func RunProfileKey(userID int, orgID *int32) string {
	if orgID != nil {
		return fmt.Sprintf("org:%d:user:%d", *orgID, userID)
	}
	return fmt.Sprintf("user:%d", userID)
}
