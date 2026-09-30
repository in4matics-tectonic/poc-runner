# Deploying to a VM

The VM runs the same compose stack with [docker-compose.vm.yml](../docker-compose.vm.yml) on top of it:

- **Caddy** serves HTTPS on 80/443 with certificates from Let's Encrypt (ZeroSSL as fallback): the showcase on `https://<domain>`, and the parts on `app.`, `backoffice.`, `chat.` and `api.<domain>`.
- **Gate:** one shared password (`SITE_PASSWORD`) protects every host. Logging in once sets a cookie for the base domain that's valid for 30 days.
- **No domain needed:** the default is `<external-ip-with-dashes>.sslip.io`, a public wildcard DNS name that resolves to the IP inside it.
- **Auto-deploy:** a systemd timer runs [autodeploy.sh](autodeploy.sh) every 2 minutes. When `poc-runner` changes, it pulls and rebuilds everything. When `main` of backend, mcp, mobile-app or backoffice moves on, it rebuilds only that service at that exact commit. A failed build leaves the running version up. There are no GitHub secrets or webhooks: the repos are public, so the VM only reads them.

## One-time setup

Requirements: Debian or Ubuntu with at least 4 GB RAM and 20 GB of disk (the Expo web build needs the memory). The VM needs an external IP.

**1. Open ports 80 and 443** (Cloud Shell, or anywhere `gcloud` is logged in):

```bash
gcloud config set project qwiklabs-gcp-01-822dd24e7bd9
gcloud compute instances add-tags tectonic-poc --zone us-east1-b --tags kbc-poc
gcloud compute firewall-rules create kbc-poc-web --allow tcp:80,tcp:443 --target-tags kbc-poc
```

**2. Optional: make the external IP static**, so the sslip.io address survives a VM stop/start:

```bash
IP=$(gcloud compute instances describe tectonic-poc --zone us-east1-b --format='value(networkInterfaces[0].accessConfigs[0].natIP)')
gcloud compute addresses create kbc-poc-ip --region us-east1 --addresses "$IP"
```

**3. Install** (SSH into the VM, e.g. `gcloud compute ssh tectonic-poc --zone us-east1-b`):

```bash
curl -fsSL https://raw.githubusercontent.com/in4matics-tectonic/poc-runner/main/deploy/bootstrap.sh \
  | sudo env SITE_PASSWORD='<site password>' ANTHROPIC_API_KEY='sk-ant-…' bash
```

This installs Docker, clones this repo to `/opt/poc-runner`, writes `.env` (random `JWT_SECRET` and `GATE_SECRET`), enables the timer and runs the first deploy. At the end it prints the URL. The demo users' password is `in4matics-must-win`. The first build takes about 5–10 minutes.

## Day to day

| Task | How |
| --- | --- |
| Deploy a change | Push to `main` of any repo. It's live within a few minutes |
| Watch deploys | `journalctl -u poc-autodeploy -f` |
| Deploy now | `sudo systemctl start poc-autodeploy` |
| Change a secret / the API key | Run the install line again with the new value. It keeps the other values and redeploys |
| Use your own domain | Point `<domain>` and `*.<domain>` at the VM, then run the install line again with `POC_DOMAIN=<domain>` added |
| Logs of a part | `cd /opt/poc-runner && sudo docker compose -f docker-compose.yml -f docker-compose.vm.yml logs -f backend` |
| Reset the demo | Backoffice → reset. To wipe everything: `sudo rm -r /opt/poc-runner/.deploy-state && sudo systemctl start poc-autodeploy` |
