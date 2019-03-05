#!/bin/bash

VERSION=$(jq -r .version ../package.json)
TAG="dockeraltoros/fabric-rest:$VERSION"
echo "Building $TAG"
docker build -t $TAG --label com.altoros.version="$VERSION" ../

