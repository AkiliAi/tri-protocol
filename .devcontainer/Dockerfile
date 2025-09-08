FROM node:18-bullseye

# Installer des outils utiles
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    nano \
    vim \
    && rm -rf /var/lib/apt/lists/*

# Créer le répertoire de travail
WORKDIR /workspace

# Exposer les ports pour votre application
EXPOSE 3000 8080