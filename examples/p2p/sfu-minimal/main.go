package main

import (
	"bomin/examples/signal"
	"bomin/utils/network"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
	"time"
)

func checkError(err error) {
	if err != nil {
		panic(err)
	}
}

func genPem() {

	if _, err := os.Stat("cert.pem"); err == nil { // file is exists
		return
	}
	//create 2 files cert.pem and key.pem
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	checkError(err)

	SNLimit := new(big.Int).Lsh(big.NewInt(1), 128)
	SN, err := rand.Int(rand.Reader, SNLimit)
	checkError(err)
	template := x509.Certificate{
		SerialNumber: SN,
		Subject: pkix.Name{
			Organization: []string{"test"},
		},
		NotBefore: time.Now(),
		NotAfter:  time.Now().Add(365 * 24 * time.Hour),

		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		BasicConstraintsValid: true,
	}
	template.DNSNames = append(template.DNSNames, network.GetOutboundIP())
	template.EmailAddresses = append(template.EmailAddresses, "test@test.com")

	certBytes, err := x509.CreateCertificate(rand.Reader, &template, &template, &privateKey.PublicKey, privateKey)
	checkError(err)
	certFile, err := os.Create("cert.pem")
	checkError(err)
	checkError(pem.Encode(certFile, &pem.Block{Type: "CERTIFICATE", Bytes: certBytes}))
	checkError(certFile.Close())

	keyFile, err := os.OpenFile("key.pem", os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	checkError(err)
	// pem.Encode(keyOut, &pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(priv.(*rsa.PrivateKey))})
	checkError(pem.Encode(keyFile, &pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privateKey)}))
	checkError(keyFile.Close())
}

func main() {
	genPem()
	fmt.Printf(network.GetOutboundIP())
	signal.HTTPSDPServer()

	defer func() {
		fmt.Println("Recover:", recover())
	}()
	panic(nil)

}
