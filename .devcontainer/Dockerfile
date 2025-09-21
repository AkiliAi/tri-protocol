FROM node:18-bullseye

# Installer des outils utiles et les dépendances Docker
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    nano \
    vim \
    ca-certificates \
    gnupg \
    lsb-release \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Installer Docker
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update \
    && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Créer le répertoire de travail
WORKDIR /workspace

# Exposer les ports pour votre application
EXPOSE 3000 8080