package notifications

type RegisterRequest struct {
	Token      string  `json:"token" minLength:"1" maxLength:"2048" doc:"Push notification token"`
	Platform   string  `json:"platform" enum:"ios,android,web" doc:"Platform type"`
	DeviceID   *string `json:"deviceId,omitempty" maxLength:"255" doc:"Unique device identifier"`
	AppVersion *string `json:"appVersion,omitempty" maxLength:"64" doc:"Application version"`
}

type DeleteRequest struct {
	Token string `json:"token" minLength:"1" maxLength:"2048" doc:"Token to remove"`
}
